import assert from "node:assert/strict";
import { createServer } from "../src/server.mjs";
import { getConfig } from "../src/config.mjs";

const config = getConfig({
  PORT: "0",
  PUBLIC_BASE_URL: "http://localhost:0",
  SALESFORCE_MODE: "mock",
  ADAPTER_REQUIRE_API_KEY: "false"
});

const server = createServer(config);
await new Promise((resolve) => server.listen(0, resolve));

try {
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "ok");

  const card = await fetch(`${baseUrl}/.well-known/agent.json`);
  assert.equal(card.status, 200);
  const cardJson = await card.json();
  assert.equal(cardJson.name, "Salesforce SDR Agent");

  const response = await fetch(`${baseUrl}/a2a/salesforce-sdr/v1/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "smoke-1",
      method: "message/send",
      params: {
        message: {
          contextId: "ctx-smoke",
          parts: [
            {
              kind: "text",
              text: "Hand over lead 00Q123 to the SDR agent for nurturing."
            },
            {
              kind: "data",
              data: {
                requestType: "handoff_to_sdr_nurture",
                originatingAgent: {
                  name: "Sales Leads Agent",
                  role: "salesforce_account_lead_opportunity_processor"
                },
                handoff: {
                  reason: "User asked to hand over the lead to SDR nurture."
                },
                salesforce: {
                  accountId: "001123",
                  leadId: "00Q123",
                  opportunityId: "006123"
                }
              }
            }
          ]
        }
      }
    })
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.id, "smoke-1");
  assert.equal(payload.result.contextId, "ctx-smoke");
  assert.equal(payload.result.kind, "message");
  assert.equal(payload.result.role, "agent");
  assert.match(payload.result.parts[0].text, /Handoff accepted: yes/);

  const streamResponse = await fetch(`${baseUrl}/a2a/salesforce-sdr/v1/message:stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "stream-smoke-1",
      method: "message/stream",
      params: {
        message: {
          contextId: "ctx-stream-smoke",
          role: "user",
          parts: [{ kind: "text", text: "Hand over Salesforce lead ID 00Q123 to the SDR for nurturing." }]
        }
      }
    })
  });

  assert.equal(streamResponse.status, 200);
  const streamText = await streamResponse.text();
  assert.match(streamText, /data: /);
  assert.match(streamText, /"jsonrpc":"2.0"/);
  assert.match(streamText, /"kind":"message"/);

  const historyResponse = await fetch(`${baseUrl}/a2a/salesforce-sdr/v1/message:stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      history: [
        {
          role: "user",
          parts: [
            {
              kind: "text",
              text: "Hand over Salesforce lead ID 00Q123 to the SDR team for lead nurturing."
            }
          ]
        }
      ]
    })
  });

  assert.equal(historyResponse.status, 200);
  const historyText = await historyResponse.text();
  assert.match(historyText, /accepted/);

  const aliasResponse = await fetch(`${baseUrl}/a2a/salesforce-sdr/v1/message-stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "alias-send-smoke-1",
      method: "message/send",
      params: {
        message: {
          contextId: "ctx-alias-send",
          role: "user",
          parts: [{ kind: "text", text: "Hand over lead 00Q123 to SDR for nurturing." }]
        }
      }
    })
  });

  assert.equal(aliasResponse.status, 200);
  const aliasJson = await aliasResponse.json();
  assert.equal(aliasJson.id, "alias-send-smoke-1");
  assert.equal(aliasJson.result.kind, "message");
  assert.match(aliasJson.result.parts[0].text, /accepted/);

  const aliasStreamResponse = await fetch(`${baseUrl}/a2a/salesforce-sdr/v1/message-stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      method: "message/stream",
      history: [
        {
          role: "user",
          parts: [{ kind: "text", text: "Hand over lead 00Q123 to SDR for nurturing." }]
        }
      ]
    })
  });

  assert.equal(aliasStreamResponse.status, 200);
  assert.match(await aliasStreamResponse.text(), /accepted/);

  console.log("Smoke test passed");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
