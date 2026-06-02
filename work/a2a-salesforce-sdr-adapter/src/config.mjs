export function getConfig(env = process.env) {
  const port = Number(env.PORT || 7071);
  const publicBaseUrl = trimTrailingSlash(env.PUBLIC_BASE_URL || `http://localhost:${port}`);
  const requireApiKey = String(env.ADAPTER_REQUIRE_API_KEY || "false").toLowerCase() === "true";

  return {
    port,
    publicBaseUrl,
    apiKey: {
      required: requireApiKey,
      header: (env.ADAPTER_API_KEY_HEADER || "x-api-key").toLowerCase(),
      value: env.ADAPTER_API_KEY || ""
    },
    salesforce: {
      mode: env.SALESFORCE_MODE || "mock",
      myDomainUrl: trimTrailingSlash(env.SALESFORCE_MY_DOMAIN_URL || ""),
      apiHost: trimTrailingSlash(env.SALESFORCE_API_HOST || "https://api.salesforce.com"),
      consumerKey: env.SALESFORCE_CONSUMER_KEY || "",
      consumerSecret: env.SALESFORCE_CONSUMER_SECRET || "",
      agentId: env.SALESFORCE_AGENT_ID || "",
      sessionUrl: env.SALESFORCE_AGENT_SESSION_URL || "",
      messageUrlTemplate: env.SALESFORCE_AGENT_MESSAGE_URL_TEMPLATE || ""
    }
  };
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}
