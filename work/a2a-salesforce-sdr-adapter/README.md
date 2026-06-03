# A2A Salesforce SDR Adapter

Minimal first-build adapter for connecting a Microsoft Copilot Studio sales-agent orchestration pattern to a Salesforce SDR agent.

Agent roles modeled in this build:

- **Copilot Studio Sales Agent**: overall user-facing orchestrator.
- **Sales Leads Agent**: processes new and updated Salesforce accounts, leads, and opportunities.
- **Salesforce SDR Agent**: receives handoffs for lead nurturing and prepares an SDR nurture plan.

This build is intentionally read-only by default:

- Serves an A2A-style agent card at `/.well-known/agent.json`.
- Accepts Copilot Studio delegated tasks at `/a2a/salesforce-sdr/v1/message`.
- Supports a simple streaming endpoint at `/a2a/salesforce-sdr/v1/message:stream`.
- Returns a structured SDR handoff/nurture recommendation in mock mode.
- Has a configurable live Salesforce Agent API path for the next integration step.

## Run Locally

```powershell
cd C:\Users\phoenixlf.lee\Documents\Codex\2026-06-01\i-started-working-on-a2a-for\work\a2a-salesforce-sdr-adapter
node src/server.mjs
```

Open:

```text
http://localhost:7071/.well-known/agent.json
```

Use this Copilot Studio A2A endpoint:

```text
http://localhost:7071/a2a/salesforce-sdr/v1/message:stream
```

For Copilot Studio cloud testing, expose the local port with Dev Tunnels or deploy this adapter to a public HTTPS host.

Copilot Studio cannot call your local `localhost` URL directly. In development, forward port `7071` from VS Code's Ports panel, make the forwarded port public, then use the generated HTTPS URL:

```text
https://<your-tunnel>-7071.dev.tunnels.ms/a2a/salesforce-sdr/v1/message:stream
```

The adapter serves the agent card at both the root standard path and the communication-endpoint-relative path:

```text
https://<your-tunnel>-7071.dev.tunnels.ms/.well-known/agent-card.json
https://<your-tunnel>-7071.dev.tunnels.ms/.well-known/agent.json
https://<your-tunnel>-7071.dev.tunnels.ms/a2a/salesforce-sdr/v1/message:stream/.well-known/agent-card.json
https://<your-tunnel>-7071.dev.tunnels.ms/a2a/salesforce-sdr/v1/message:stream/.well-known/agent.json
```

## Smoke Test

```powershell
node scripts/smoke-test.mjs
```

## Example Request

```powershell
$body = @{
  jsonrpc = "2.0"
  id = "demo-1"
  method = "message/send"
  params = @{
    message = @{
      contextId = "demo-context"
      parts = @(
        @{
          kind = "text"
          text = "Hand over lead 00Q123 to the SDR agent for nurturing."
        },
        @{
          kind = "data"
          data = @{
            requestType = "handoff_to_sdr_nurture"
            originatingAgent = @{
              name = "Sales Leads Agent"
              role = "salesforce_account_lead_opportunity_processor"
            }
            handoff = @{
              reason = "User asked to hand over the lead to SDR nurture."
            }
            salesforce = @{
              accountId = "001123"
              leadId = "00Q123"
              opportunityId = "006123"
            }
          }
        }
      )
    }
  }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod `
  -Uri http://localhost:7071/a2a/salesforce-sdr/v1/message `
  -Method POST `
  -ContentType "application/json" `
  -Body $body
```

## Handoff Contract

The Sales Leads agent should call the SDR adapter when the user asks to hand over a Salesforce lead for nurturing, or when lead-processing logic determines the lead is not ready for immediate opportunity conversion but should stay warm.

Recommended data payload:

```json
{
  "requestType": "handoff_to_sdr_nurture",
  "originatingAgent": {
    "name": "Sales Leads Agent",
    "role": "salesforce_account_lead_opportunity_processor"
  },
  "handoff": {
    "reason": "User asked to hand over the lead to SDR nurture.",
    "priority": "normal"
  },
  "salesforce": {
    "accountId": "001...",
    "leadId": "00Q...",
    "opportunityId": "006..."
  },
  "constraints": {
    "mayWriteToSalesforce": false,
    "requiresHumanApprovalForWrites": true
  }
}
```

In this first build, the adapter accepts the handoff and returns proposed Salesforce updates only. It does not update Salesforce records.

## Configuration

Copy `.env.example` into your deployment settings. This app does not load `.env` automatically; set environment variables in PowerShell, your host, or your container runtime.

Important variables:

| Variable | Purpose |
| --- | --- |
| `PORT` | Local HTTP port. Defaults to `7071`. |
| `PUBLIC_BASE_URL` | Public URL used in the agent card. |
| `ADAPTER_AUTH_MODE` | Inbound auth mode for A2A calls. Use `none`, `api_key`, or `salesforce_oauth`. |
| `ADAPTER_REQUIRE_API_KEY` | Set `true` to require an API key. |
| `ADAPTER_API_KEY` | API key value expected from Copilot Studio. |
| `ADAPTER_API_KEY_HEADER` | Header name. Defaults to `x-api-key`. |
| `SALESFORCE_USERINFO_URL` | Optional Salesforce UserInfo endpoint override for inbound `salesforce_oauth`. Defaults to `{SALESFORCE_MY_DOMAIN_URL}/services/oauth2/userinfo`, or `https://login.salesforce.com/services/oauth2/userinfo` if no My Domain is set. |
| `SALESFORCE_ALLOWED_EMAIL_DOMAINS` | Optional comma-separated email domains allowed to call the adapter. |
| `SALESFORCE_ALLOWED_USERNAMES` | Optional comma-separated Salesforce usernames allowed to call the adapter. |
| `SALESFORCE_ALLOWED_ORG_IDS` | Optional comma-separated Salesforce org IDs allowed to call the adapter. |
| `SALESFORCE_MODE` | `mock` or `live`. Defaults to `mock`. |
| `SALESFORCE_MY_DOMAIN_URL` | Salesforce My Domain URL for OAuth. |
| `SALESFORCE_API_HOST` | Agent API host. Defaults to `https://api.salesforce.com`. |
| `SALESFORCE_CONSUMER_KEY` | External Client App consumer key. |
| `SALESFORCE_CONSUMER_SECRET` | External Client App consumer secret. |
| `SALESFORCE_AGENT_ID` | Salesforce Agentforce agent ID. |
| `SALESFORCE_AGENT_SESSION_URL` | Agent API session endpoint for your org/API version. |
| `SALESFORCE_AGENT_MESSAGE_URL_TEMPLATE` | Agent API message endpoint template. Supports `{agentId}` and `{sessionId}`. |

## Salesforce Sandbox Live Mode

To try the adapter against an existing Salesforce sandbox SDR agent, configure these Azure App Service settings:

```text
SALESFORCE_MODE=live
SALESFORCE_MY_DOMAIN_URL=https://<your-sandbox-my-domain>.sandbox.my.salesforce.com
SALESFORCE_API_HOST=https://api.salesforce.com
SALESFORCE_CONSUMER_KEY=<external-client-app-consumer-key>
SALESFORCE_CONSUMER_SECRET=<external-client-app-consumer-secret>
SALESFORCE_AGENT_ID=<agent-id>
```

The adapter defaults to the current Agent API paths:

```text
POST https://api.salesforce.com/einstein/ai-agent/v1/agents/{agentId}/sessions
POST https://api.salesforce.com/einstein/ai-agent/v1/sessions/{sessionId}/messages
```

Only set `SALESFORCE_AGENT_SESSION_URL` or `SALESFORCE_AGENT_MESSAGE_URL_TEMPLATE` if your sandbox requires custom endpoint overrides.

The live adapter still tells Copilot Studio that proposed Salesforce writes require approval. It does not mark writes as completed unless the Salesforce agent response explicitly does so.

## Inbound Salesforce Authentication

For access control on the A2A endpoint, configure the adapter to require a Salesforce OAuth bearer token:

```text
ADAPTER_AUTH_MODE=salesforce_oauth
SALESFORCE_MY_DOMAIN_URL=https://<your-sandbox-my-domain>.sandbox.my.salesforce.com
SALESFORCE_ALLOWED_EMAIL_DOMAINS=advantech.com,advantech.com.tw
```

In this mode, the adapter rejects A2A POST calls unless the request includes:

```http
Authorization: Bearer <salesforce-access-token>
```

The adapter validates that token through Salesforce UserInfo before invoking the SDR logic. Salesforce documents the UserInfo endpoint as `/services/oauth2/userinfo`; the token introspection endpoint is `/services/oauth2/introspect` if stricter server-side validation is needed later.

For Copilot Studio, the generated A2A connector should be configured with Salesforce OAuth rather than `None`. Use the Salesforce sandbox authorize/token endpoints:

```text
Authorization URL: https://test.salesforce.com/services/oauth2/authorize
Token URL: https://test.salesforce.com/services/oauth2/token
Refresh URL: https://test.salesforce.com/services/oauth2/token
Scopes: openid api refresh_token
```

For production Salesforce orgs, use `https://login.salesforce.com` or the org My Domain host instead of `https://test.salesforce.com`.

## Production Checklist

- Deploy behind HTTPS.
- Enable Salesforce OAuth authentication from Copilot Studio to the adapter.
- Store Salesforce secrets in a managed secret store.
- Replace mock mode with confirmed Salesforce Agent API endpoint templates.
- Add durable task storage before supporting long-running work.
- Keep Salesforce writes disabled until approval and audit policy are implemented.
