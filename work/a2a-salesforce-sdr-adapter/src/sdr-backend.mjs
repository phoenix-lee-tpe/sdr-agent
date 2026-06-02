export async function runSdrTask(config, request) {
  if (config.salesforce.mode === "live") {
    return runLiveSalesforceTask(config.salesforce, request);
  }

  return runMockSdrTask(request);
}

function runMockSdrTask(request) {
  const message = request.structuredContext.latestUserMessage || request.text || "Qualify this lead.";
  const leadId = request.structuredContext.salesforce?.leadId || "not-provided";
  const accountId = request.structuredContext.salesforce?.accountId || "not-provided";
  const opportunityId = request.structuredContext.salesforce?.opportunityId || "not-provided";
  const requestType = request.structuredContext.requestType;
  const isBatch = /\b(all|multiple|\d+)\b[\s\S]{0,80}\b(leads|contacts|prospects)\b/i.test(message);
  const isHandoff = requestType === "handoff_to_sdr_nurture" || isBatch;

  return {
    mode: "mock",
    summary: isBatch
      ? "Mock SDR batch handoff accepted: the provided leads/contacts are queued for SDR nurture planning. No Salesforce records were changed in this read-only first build."
      : isHandoff
        ? "Mock SDR handoff accepted: the lead is queued for nurture planning. No Salesforce records were changed in this read-only first build."
      : "Mock SDR read-only result: the prospect looks worth prioritizing if the Salesforce record confirms budget, authority, and near-term timing.",
    source: {
      leadId,
      accountId,
      opportunityId,
      requestType,
      originatingAgent: request.structuredContext.originatingAgent
    },
    handoff: {
      accepted: true,
      type: isBatch ? "batch_lead_nurture" : "lead_nurture",
      reason: request.structuredContext.handoff?.reason || "User asked to hand over the lead to SDR nurture.",
      ownerRecommendation: "Assign to SDR queue or named SDR after record ownership and territory rules are checked."
    },
    qualification: {
      status: isHandoff ? "accepted_for_nurture" : "needs_review",
      confidence: "medium",
      reasons: [
        isHandoff
          ? "The originating agent requested SDR nurturing for this Salesforce lead."
          : "The request indicates active sales-development intent.",
        "The SDR agent should review Salesforce account, lead, and opportunity context before outreach.",
        "No write action was taken because this first build is read-only."
      ],
      risks: [
        "Budget, authority, need, and timeline were not all confirmed.",
        "The adapter is running in mock mode."
      ]
    },
    recommendedNextAction: {
      type: isHandoff ? "select_sdr_template_and_prepare_mailbox_drafts_after_user_request" : "review_template_and_personalize_outreach",
      requiresApproval: true,
      template: {
        source: "Salesforce SDR Agent v2 email templates",
        recommendation: "Use the best matching SDR nurture or first-touch template, then personalize it with verified Salesforce context. If no appropriate template exists for these leads or contacts, propose a new template for user review and approval.",
        fallback: "request_new_template_proposal",
        requiresSelectionInLiveMode: true
      },
      mailboxDrafts: {
        action: "create_user_mailbox_drafts_after_user_request",
        owner: "Copilot Studio sales orchestrator with the user's Outlook or Microsoft Graph connection",
        sendAutomatically: false,
        reviewedSendAllowedAfterExplicitUserApproval: true,
        requiresRecipientEmail: true
      },
      draft:
        "Template-based first-touch draft placeholder: personalize the selected Salesforce SDR template with the prospect's verified company, role, pain point, and relevant Advantech context before approval."
    },
    nurturePlan: {
      cadence: [
        {
          day: 0,
          channel: "email",
          action: "Select the best matching Salesforce SDR email template and personalize the first-touch email, or propose a new template if no existing template fits."
        },
        {
          day: 2,
          channel: "phone",
          action: "Call and log outcome in Salesforce."
        },
        {
          day: 5,
          channel: "linkedin_or_email",
          action: "Send value-based follow-up tied to account pain point."
        }
      ],
      exitCriteria: [
        "Prospect replies or books a meeting.",
        "Lead is disqualified by SDR.",
        "Nurture cadence completes without engagement."
      ]
    },
    salesforceUpdates: [
      {
        object: "Lead",
        id: leadId,
        field: "Status",
        proposedValue: "Working - Contacted",
        requiresApproval: true
      },
      {
        object: "Task",
        id: "new",
        field: "Subject",
        proposedValue: "Start SDR nurture cadence",
        requiresApproval: true
      }
    ],
    echo: {
      userMessage: message
    }
  };
}

async function runLiveSalesforceTask(salesforce, request) {
  validateLiveConfig(salesforce);

  const accessToken = await fetchSalesforceToken(salesforce);
  const session = await createAgentSession(salesforce, accessToken, request);
  const response = await sendAgentMessage(salesforce, accessToken, session, request);

  return {
    mode: "live",
    summary: response.summary || response.message || "Salesforce SDR agent returned a response.",
    source: {
      salesforceSessionId: session.sessionId || session.id,
      requestType: request.structuredContext.requestType
    },
    qualification: response.qualification || {
      status: "returned_by_salesforce",
      confidence: "unknown",
      reasons: [],
      risks: []
    },
    recommendedNextAction: response.recommendedNextAction || {
      type: "review_salesforce_response",
      requiresApproval: true
    },
    salesforceUpdates: response.salesforceUpdates || [],
    rawSalesforceResponse: response
  };
}

function validateLiveConfig(salesforce) {
  const missing = [];
  for (const [key, value] of Object.entries({
    SALESFORCE_MY_DOMAIN_URL: salesforce.myDomainUrl,
    SALESFORCE_API_HOST: salesforce.apiHost,
    SALESFORCE_CONSUMER_KEY: salesforce.consumerKey,
    SALESFORCE_CONSUMER_SECRET: salesforce.consumerSecret,
    SALESFORCE_AGENT_ID: salesforce.agentId
  })) {
    if (!value) missing.push(key);
  }

  if (missing.length > 0) {
    const error = new Error(`Missing live Salesforce configuration: ${missing.join(", ")}`);
    error.statusCode = 500;
    throw error;
  }
}

async function fetchSalesforceToken(salesforce) {
  const tokenUrl = `${salesforce.myDomainUrl}/services/oauth2/token`;
  const form = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: salesforce.consumerKey,
    client_secret: salesforce.consumerSecret
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form
  });

  if (!response.ok) {
    throw new Error(`Salesforce token request failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!payload.access_token) {
    throw new Error("Salesforce token response did not include access_token");
  }

  return payload.access_token;
}

async function createAgentSession(salesforce, accessToken, request) {
  const sessionUrl =
    salesforce.sessionUrl ||
    `${salesforce.apiHost}/einstein/ai-agent/v1/agents/${encodeURIComponent(salesforce.agentId)}/sessions`;

  const response = await fetch(sessionUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      externalSessionKey: request.contextId,
      instanceConfig: {
        endpoint: salesforce.myDomainUrl
      },
      tz: "Asia/Taipei",
      variables: [
        {
          name: "$Context.EndUserLanguage",
          type: "Text",
          value: "en_US"
        }
      ],
      featureSupport: "Streaming",
      streamingCapabilities: {
        chunkTypes: ["Text"]
      },
      bypassUser: true
    })
  });

  if (!response.ok) {
    throw new Error(`Salesforce Agent API session request failed with HTTP ${response.status}`);
  }

  return response.json();
}

async function sendAgentMessage(salesforce, accessToken, session, request) {
  const sessionId = session.sessionId || session.id;
  const messageUrl = salesforce.messageUrlTemplate
    ? salesforce.messageUrlTemplate
        .replace("{agentId}", encodeURIComponent(salesforce.agentId))
        .replace("{sessionId}", encodeURIComponent(sessionId))
    : `${salesforce.apiHost}/einstein/ai-agent/v1/sessions/${encodeURIComponent(sessionId)}/messages`;

  const response = await fetch(messageUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({
      message: {
        sequenceId: Math.floor(Date.now() / 1000),
        type: "Text",
        text: buildSalesforceAgentPrompt(request)
      },
      variables: []
    })
  });

  if (!response.ok) {
    throw new Error(`Salesforce Agent API message request failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  return normalizeSalesforceResponse(payload);
}

function buildSalesforceAgentPrompt(request) {
  const context = request.structuredContext;
  const sf = context.salesforce || {};
  const handoff = context.handoff || {};

  return [
    request.text,
    "",
    "Handoff context:",
    `- Request type: ${context.requestType}`,
    `- Lead ID: ${sf.leadId || "not provided"}`,
    `- Account ID: ${sf.accountId || "not provided"}`,
    `- Opportunity ID: ${sf.opportunityId || "not provided"}`,
    `- Handoff reason: ${handoff.reason || "Lead nurture requested from Copilot Studio sales orchestrator."}`,
    "- Required outcome: confirm handoff acceptance, recommend a nurture cadence, select or recommend the best matching Salesforce SDR email template, draft first-touch outreach from that template, and propose Salesforce updates.",
    "- Template fallback: if no appropriate existing SDR email template fits the subject leads or contacts, propose a new template for user review and approval instead of forcing a poor match.",
    "- Mailbox draft handoff: if the user asks to generate personalized first-touch emails, return recipient-ready subject and body content for each lead so the Copilot Studio sales orchestrator can create drafts in the user's mailbox through its Outlook or Microsoft Graph connection. Do not send emails during draft creation. After the user reviews the drafts, the orchestrator may send reviewed drafts only after explicit user approval.",
    "- Constraint: do not execute Salesforce writes unless approval is explicitly granted."
  ].join("\n");
}

function normalizeSalesforceResponse(payload) {
  const informMessages = Array.isArray(payload?.messages)
    ? payload.messages.filter((message) => message.type === "Inform" || message.message)
    : [];
  const text = informMessages.map((message) => message.message).filter(Boolean).join("\n\n");

  return {
    summary: text || "Salesforce SDR agent returned a response.",
    qualification: {
      status: "returned_by_salesforce",
      confidence: "unknown",
      reasons: text ? ["Salesforce Agent API returned an Inform message."] : [],
      risks: []
    },
    recommendedNextAction: {
      type: "review_salesforce_sdr_response",
      requiresApproval: true,
      draft: text
    },
    salesforceUpdates: [],
    messages: payload?.messages || [],
    links: payload?._links || {}
  };
}
