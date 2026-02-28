import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { disabledWebhookEndpoint } from "../_shared/cashoutDisabled.ts";

export const config = { verify_jwt: false };

serve(
  disabledWebhookEndpoint("dots", "dots-webhook"),
);
