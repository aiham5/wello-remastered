import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createDotsWebhookHandler } from "../_shared/dotsWebhook.ts";

export const config = { verify_jwt: false };

serve(
  createDotsWebhookHandler({
    endpointName: "dots-webhook",
  }),
);
