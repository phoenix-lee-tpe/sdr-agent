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
| `ADAPTER_REQUIRE_API_KEY` | Set `true` to require an API key. |
| `ADAPTER_API_KEY` | API key value expected from Copilot Studio. |
| `ADAPTER_API_KEY_HEADER` | Header name. Defaults to `x-api-key`. |
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

## Production Checklist

- Deploy behind HTTPS.
- Enable authentication from Copilot Studio to the adapter.
- Store Salesforce secrets in a managed secret store.
- Replace mock mode with confirmed Salesforce Agent API endpoint templates.
- Add durable task storage before supporting long-running work.
- Keep Salesforce writes disabled until approval and audit policy are implemented.
