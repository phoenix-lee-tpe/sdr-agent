# SDR Agent A2A Project

This repository contains the Salesforce SDR Agent A2A adapter and Copilot Studio integration artifacts for the Advantech sales-agent orchestration workflow.

## Contents

- `work/a2a-salesforce-sdr-adapter/` - Node.js A2A adapter for Copilot Studio Agent2Agent integration.
- `outputs/` - design notes, Copilot Studio instructions, and Power Automate flow specifications.
- `outputs/salesforce-sdr-native-wrapper-agent-instructions.txt` - instructions for the native Copilot Studio SDR wrapper agent.

## Deployed Endpoint

```text
https://a2a-salesforce-sdr-pl.azurewebsites.net/a2a/salesforce-sdr/v1/message-stream
```

## Local Development

```powershell
cd work/a2a-salesforce-sdr-adapter
npm install
npm start
```

Health check:

```text
http://localhost:7071/healthz
```

## Architecture

The intended Copilot Studio routing is:

1. `sales agent` stays the top-level orchestrator.
2. `Sales Leads Agent` owns Salesforce lead/account/opportunity processing.
3. `Salesforce SDR Native Agent` owns SDR operations.
4. `Salesforce SDR Native Agent` calls the external A2A `Salesforce SDR Agent v2`.
5. `Salesforce SDR Native Agent` owns `create_sdr_email_drafts_v2` for Outlook draft creation.

