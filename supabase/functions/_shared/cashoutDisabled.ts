import { json } from "./auth.ts";

export const disabledCashoutEndpoint = (
  provider: string,
  endpointName: string,
) => (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  console.warn(`[${endpointName}] called after provider deprecation (${provider})`);
  return json(
    {
      error: `${provider} cashout endpoint is disabled.`,
      reason: "provider_disabled",
      provider,
    },
    410,
  );
};

export const disabledWebhookEndpoint = (
  provider: string,
  endpointName: string,
) => (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  console.warn(`[${endpointName}] webhook called after provider deprecation (${provider})`);
  return json(
    {
      received: false,
      error: `${provider} webhook endpoint is disabled.`,
      reason: "provider_disabled",
      provider,
    },
    410,
  );
};
