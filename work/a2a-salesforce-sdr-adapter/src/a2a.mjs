import crypto from "node:crypto";

export function buildAgentCard(config) {
  const base = config.publicBaseUrl;

  return {
    name: "Salesforce SDR Agent",
    description:
      "Accepts handoffs from a Copilot Studio sales orchestrator or Sales Leads agent to nurture Salesforce leads with SDR follow-up planning, outreach preparation, and next-best action recommendations.",
    url: `${base}/a2a/salesforce-sdr/v1/message-stream`,
    version: "0.1.0",
    protocolVersion: "0.3.0",
    preferredTransport: "JSONRPC",
    additionalInterfaces: [
      {
        url: `${base}/a2a/salesforce-sdr/v1/message`,
        transport: "JSONRPC"
      },
      {
        url: `${base}/a2a/salesforce-sdr/v1/message:stream`,
        transport: "JSONRPC"
      },
      {
        url: `${base}/a2a/salesforce-sdr/v1/message-stream`,
        transport: "JSONRPC"
      }
    ],
    capabilities: {
      streaming: true,
      pushNotifications: false
    },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
      {
        id: "handoff-to-sdr-nurture",
        name: "Handoff to SDR Nurture",
        description:
          "Accepts a Salesforce lead handoff from the sales orchestrator or Sales Leads agent and prepares a nurture plan.",
        tags: ["salesforce", "sdr", "lead-nurture", "handoff"],
        examples: ["Hand over lead 00Q123 to the SDR agent for nurturing."],
        inputModes: ["text/plain", "application/json"],
        outputModes: ["text/plain", "application/json"]
      },
      {
        id: "lead-qualification",
        name: "Lead Qualification",
        description: "Qualifies Salesforce leads using CRM context and SDR criteria.",
        tags: ["salesforce", "lead-qualification"],
        examples: ["Qualify this Salesforce lead."],
        inputModes: ["text/plain", "application/json"],
        outputModes: ["text/plain", "application/json"]
      },
      {
        id: "outreach-prep",
        name: "Outreach Preparation",
        description: "Drafts personalized SDR outreach and call-prep notes.",
        tags: ["sdr", "outreach"],
        examples: ["Draft a first-touch SDR email."],
        inputModes: ["text/plain", "application/json"],
        outputModes: ["text/plain", "application/json"]
      },
      {
        id: "next-best-action",
        name: "Next Best Action",
        description: "Recommends the next CRM or engagement action for a prospect.",
        tags: ["salesforce", "next-best-action"],
        examples: ["Recommend the next action for this prospect."],
        inputModes: ["text/plain", "application/json"],
        outputModes: ["text/plain", "application/json"]
      }
    ]
  };
}

export function parseA2aRequest(body) {
  const params = body?.params || {};
  const message = params.message || params;
  const historyMessage = Array.isArray(body?.history) ? body.history.at(-1) : null;
  const effectiveMessage = historyMessage || message;
  const contextId = effectiveMessage.contextId || params.contextId || body?.contextId || crypto.randomUUID();
  const messageId = effectiveMessage.messageId || crypto.randomUUID();
  const metadata = effectiveMessage.metadata || body?.metadata || {};
  const text = extractText(effectiveMessage);
  const structuredContext = extractStructuredContext(effectiveMessage, text);

  return {
    jsonrpc: body?.jsonrpc || "2.0",
    id: body?.id ?? crypto.randomUUID(),
    method: body?.method || "message/send",
    contextId,
    messageId,
    metadata,
    text,
    structuredContext
  };
}

export function buildTaskResponse(request, sdrResult) {
  const taskId = crypto.randomUUID();
  const text = [
    sdrResult.summary,
    "",
    `Qualification: ${sdrResult.qualification.status} (${sdrResult.qualification.confidence} confidence)`,
    `Next action: ${sdrResult.recommendedNextAction.type}`,
    sdrResult.recommendedNextAction.draft ? `Draft: ${sdrResult.recommendedNextAction.draft}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  return {
    jsonrpc: "2.0",
    id: request.id,
    result: {
      kind: "task",
      id: taskId,
      contextId: request.contextId,
      status: {
        state: "completed",
        timestamp: new Date().toISOString()
      },
      artifacts: [
        {
          artifactId: crypto.randomUUID(),
          name: "salesforce-sdr-summary",
          parts: [{ kind: "text", text }]
        },
        {
          artifactId: crypto.randomUUID(),
          name: "salesforce-sdr-structured-result",
          parts: [{ kind: "data", data: sdrResult }]
        }
      ],
      metadata: {
        adapter: "a2a-salesforce-sdr-adapter",
        salesforceMode: sdrResult.mode
      }
    }
  };
}

export function buildMessageResponse(request, sdrResult) {
  const text = [
    sdrResult.summary,
    "",
    `Handoff accepted: ${sdrResult.handoff?.accepted ? "yes" : "no"}`,
    `Qualification: ${sdrResult.qualification.status} (${sdrResult.qualification.confidence} confidence)`,
    `Next action: ${sdrResult.recommendedNextAction.type}`,
    "",
    "Nurture cadence:",
    ...(sdrResult.nurturePlan?.cadence || []).map(
      (step) => `- Day ${step.day}: ${step.channel} - ${step.action}`
    ),
    "",
    sdrResult.recommendedNextAction.draft ? `Outreach draft: ${sdrResult.recommendedNextAction.draft}` : "",
    sdrResult.recommendedNextAction.mailboxDrafts
      ? "Mailbox drafts: ready for the sales orchestrator to create in the user's mailbox after the user requests email generation. Draft creation must not send emails. After the user reviews the drafts, the orchestrator may send reviewed drafts only after explicit user approval."
      : "",
    "",
    "Proposed Salesforce updates require approval before execution."
  ]
    .filter(Boolean)
    .join("\n");

  return {
    jsonrpc: "2.0",
    id: request.id,
    result: {
      kind: "message",
      messageId: crypto.randomUUID(),
      role: "agent",
      contextId: request.contextId,
      parts: [{ kind: "text", text }],
      metadata: {
        adapter: "a2a-salesforce-sdr-adapter",
        salesforceMode: sdrResult.mode
      }
    }
  };
}

export function buildJsonRpcError(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
      ...(data ? { data } : {})
    }
  };
}

function extractText(message) {
  if (typeof message === "string") {
    return message;
  }

  if (typeof message?.text === "string") {
    return message.text;
  }

  if (Array.isArray(message?.parts)) {
    return message.parts
      .map((part) => part.text || part.data?.text || "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (message?.parts && typeof message.parts === "object") {
    return Object.values(message.parts)
      .map((part) => part?.text || "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (Array.isArray(message?.content)) {
    return message.content
      .map((part) => part.text || "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

function extractStructuredContext(message, text) {
  const dataPart = Array.isArray(message?.parts)
    ? message.parts.find((part) => part.kind === "data" || part.data)
    : null;

  return {
    requestType: dataPart?.data?.requestType || inferRequestType(text),
    handoff: dataPart?.data?.handoff || {},
    originatingAgent: dataPart?.data?.originatingAgent || inferOriginatingAgent(message),
    latestUserMessage: text,
    salesforce: dataPart?.data?.salesforce || {},
    constraints: {
      mayWriteToSalesforce: false,
      requiresHumanApprovalForWrites: true,
      ...(dataPart?.data?.constraints || {})
    }
  };
}

function inferRequestType(text) {
  const normalized = text.toLowerCase();
  if (normalized.includes("handoff") || normalized.includes("hand over") || normalized.includes("nurtur")) {
    return "handoff_to_sdr_nurture";
  }
  if (normalized.includes("draft") || normalized.includes("email") || normalized.includes("outreach")) {
    return "outreach_prep";
  }
  if (normalized.includes("next") || normalized.includes("follow up") || normalized.includes("follow-up")) {
    return "next_best_action";
  }
  return "lead_qualification";
}

function inferOriginatingAgent(message) {
  return {
    name: message?.metadata?.originatingAgentName || "copilot-studio-sales-orchestrator",
    role: message?.metadata?.originatingAgentRole || "overall_sales_orchestrator"
  };
}
