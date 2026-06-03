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
    const authContext = await authorizeRequest(config, req);
    if (!authContext.authorized) {
      writeJson(res, authContext.statusCode || 401, buildJsonRpcError(null, -32001, authContext.message || "Unauthorized"));
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
    a2aRequest.auth = authContext.user || null;
    if (authContext.user) {
      a2aRequest.structuredContext.authenticatedSalesforceUser = authContext.user;
    }
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

async function authorizeRequest(config, req) {
  switch (config.auth.mode) {
    case "none":
      return { authorized: true };
    case "api_key":
      return authorizeApiKey(config, req);
    case "salesforce_oauth":
      return authorizeSalesforceOAuth(config, req);
    default:
      return { authorized: false, statusCode: 500, message: `Unsupported adapter auth mode: ${config.auth.mode}` };
  }
}

function authorizeApiKey(config, req) {
  if (!config.apiKey.required && config.auth.mode !== "api_key") {
    return { authorized: true };
  }

  const provided = req.headers[config.apiKey.header];
  return Boolean(config.apiKey.value) && provided === config.apiKey.value
    ? { authorized: true }
    : { authorized: false, statusCode: 401, message: "Unauthorized" };
}

async function authorizeSalesforceOAuth(config, req) {
  const token = extractBearerToken(req);
  if (!token) {
    return { authorized: false, statusCode: 401, message: "Missing Salesforce bearer token" };
  }

  try {
    const user = await fetchSalesforceUserInfo(config, token);
    const allowed = isAllowedSalesforceUser(config, user);
    return allowed
      ? { authorized: true, user }
      : { authorized: false, statusCode: 403, message: "Salesforce user is not allowed to invoke this adapter" };
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "salesforce_auth_failed",
        message: error.message,
        timestamp: new Date().toISOString()
      })
    );
    return { authorized: false, statusCode: 401, message: "Salesforce authentication failed" };
  }
}

function extractBearerToken(req) {
  const authorization = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1] || "";
}

async function fetchSalesforceUserInfo(config, token) {
  const userInfoUrl =
    config.auth.userInfoUrl ||
    `${config.salesforce.myDomainUrl || "https://login.salesforce.com"}/services/oauth2/userinfo`;

  const response = await fetch(userInfoUrl, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Salesforce UserInfo request failed with HTTP ${response.status}`);
  }

  return normalizeSalesforceUserInfo(await response.json());
}

function normalizeSalesforceUserInfo(userInfo) {
  const organizationId =
    userInfo.organization_id ||
    userInfo.organizationId ||
    extractOrgIdFromSalesforceUrls(userInfo.urls || {});

  return {
    userId: userInfo.user_id || userInfo.userId || userInfo.sub || "",
    username: userInfo.preferred_username || userInfo.username || userInfo.email || "",
    email: userInfo.email || "",
    name: userInfo.name || "",
    organizationId,
    profile: userInfo.profile || "",
    raw: userInfo
  };
}

function extractOrgIdFromSalesforceUrls(urls) {
  for (const value of Object.values(urls)) {
    const match = typeof value === "string" ? /\/id\/([^/]+)\//.exec(value) : null;
    if (match) return match[1];
  }
  return "";
}

function isAllowedSalesforceUser(config, user) {
  const email = user.email.toLowerCase();
  const username = user.username.toLowerCase();
  const orgId = user.organizationId;

  if (
    config.auth.allowedOrgIds.length > 0 &&
    !config.auth.allowedOrgIds.some((allowedOrgId) => allowedOrgId === orgId)
  ) {
    return false;
  }

  if (
    config.auth.allowedUsernames.length > 0 &&
    !config.auth.allowedUsernames.some((allowedUsername) => allowedUsername.toLowerCase() === username)
  ) {
    return false;
  }

  if (
    config.auth.allowedEmailDomains.length > 0 &&
    !config.auth.allowedEmailDomains.some((domain) => email.endsWith(`@${domain.toLowerCase()}`))
  ) {
    return false;
  }

  return true;
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
