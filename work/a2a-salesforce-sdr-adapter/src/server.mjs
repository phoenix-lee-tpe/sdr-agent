import http from "node:http";
import path from "node:path";
import { getConfig } from "./config.mjs";
import { buildAgentCard, buildJsonRpcError, buildMessageResponse, buildTaskResponse, parseA2aRequest } from "./a2a.mjs";
import { runSdrTask } from "./sdr-backend.mjs";

const config = getConfig();

export function createServer(configOverride = config) {
  return http.createServer(async (req, res) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      console.log(
        JSON.stringify({
          event: "response",
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          contentType: res.getHeader("content-type") || "",
          durationMs: Date.now() - startedAt,
          timestamp: new Date().toISOString()
        })
      );
    });

    try {
      console.log(
        JSON.stringify({
          event: "request",
          method: req.method,
          url: req.url,
          userAgent: req.headers["user-agent"] || "",
          timestamp: new Date().toISOString()
        })
      );
      await routeRequest(configOverride, req, res);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "request_error",
          message: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString()
        })
      );
      const statusCode = error.statusCode || 500;
      writeJson(res, statusCode, buildJsonRpcError(null, -32000, error.message));
    }
  });
}

async function routeRequest(config, req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/") {
    writeJson(res, 200, {
      name: "A2A Salesforce SDR Adapter",
      status: "running",
      endpoints: {
        health: "/healthz",
        agentCard: "/.well-known/agent.json",
        message: "/a2a/salesforce-sdr/v1/message",
        stream: "/a2a/salesforce-sdr/v1/message:stream"
      }
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/healthz") {
    writeJson(res, 200, {
      status: "ok",
      salesforceMode: config.salesforce.mode,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (req.method === "GET" && isAgentCardPath(url.pathname)) {
    writeJson(res, 200, buildAgentCard(config));
    return;
  }

  if (
    req.method === "POST" &&
    (url.pathname === "/a2a/salesforce-sdr/v1/message" ||
      url.pathname === "/a2a/salesforce-sdr/v1/message:stream" ||
      url.pathname === "/a2a/salesforce-sdr/v1/message-stream" ||
      url.pathname === "/a2a/salesforce-sdr/v1/message/stream")
  ) {
    if (!isAuthorized(config, req)) {
      writeJson(res, 401, buildJsonRpcError(null, -32001, "Unauthorized"));
      return;
    }

    const body = await readJson(req);
    console.log(
      JSON.stringify({
        event: "a2a_body_shape",
        hasJsonRpc: Boolean(body?.jsonrpc),
        method: body?.method || "",
        hasParamsMessage: Boolean(body?.params?.message),
        hasHistory: Array.isArray(body?.history),
        historyLength: Array.isArray(body?.history) ? body.history.length : 0,
        timestamp: new Date().toISOString()
      })
    );
    const a2aRequest = parseA2aRequest(body);
    const sdrResult = await runSdrTask(config, a2aRequest);

    if (isStreamRequest(url.pathname, a2aRequest.method)) {
      writeServerSentEvent(res, buildMessageResponse(a2aRequest, sdrResult));
      return;
    }

    const response = buildMessageResponse(a2aRequest, sdrResult);
    writeJson(res, 200, response);
    return;
  }

  writeJson(res, 404, { error: "not_found" });
}

function isAgentCardPath(pathname) {
  return (
    pathname === "/.well-known/agent.json" ||
    pathname === "/.well-known/agent-card.json" ||
    pathname === "/a2a/salesforce-sdr/.well-known/agent.json" ||
    pathname === "/a2a/salesforce-sdr/.well-known/agent-card.json" ||
    pathname === "/a2a/salesforce-sdr/v1/card" ||
    pathname === "/a2a/salesforce-sdr/v1/.well-known/agent.json" ||
    pathname === "/a2a/salesforce-sdr/v1/.well-known/agent-card.json" ||
    pathname === "/a2a/salesforce-sdr/v1/message/.well-known/agent.json" ||
    pathname === "/a2a/salesforce-sdr/v1/message/.well-known/agent-card.json" ||
    pathname === "/a2a/salesforce-sdr/v1/message:stream/.well-known/agent.json" ||
    pathname === "/a2a/salesforce-sdr/v1/message:stream/.well-known/agent-card.json" ||
    pathname === "/a2a/salesforce-sdr/v1/message-stream/.well-known/agent.json" ||
    pathname === "/a2a/salesforce-sdr/v1/message-stream/.well-known/agent-card.json" ||
    pathname === "/a2a/salesforce-sdr/v1/message/stream/.well-known/agent.json" ||
    pathname === "/a2a/salesforce-sdr/v1/message/stream/.well-known/agent-card.json"
  );
}

function isStreamRequest(pathname, method) {
  if (method === "message/send") {
    return false;
  }

  if (method === "message/stream") {
    return true;
  }

  return (
    pathname.endsWith(":stream") ||
    pathname.endsWith("/message-stream") ||
    pathname.endsWith("/message/stream")
  );
}

function isAuthorized(config, req) {
  if (!config.apiKey.required) {
    return true;
  }

  const provided = req.headers[config.apiKey.header];
  return Boolean(config.apiKey.value) && provided === config.apiKey.value;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        const error = new Error("Invalid JSON request body");
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function writeServerSentEvent(res, payload) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-store",
    connection: "keep-alive"
  });
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  res.end();
}

if (process.argv[1] && path.basename(process.argv[1]) === "server.mjs") {
  createServer(config).listen(config.port, () => {
    console.log(`A2A Salesforce SDR adapter listening on http://localhost:${config.port}`);
    console.log(`Agent card: ${config.publicBaseUrl}/.well-known/agent.json`);
    console.log(`Message endpoint: ${config.publicBaseUrl}/a2a/salesforce-sdr/v1/message`);
  });
}
