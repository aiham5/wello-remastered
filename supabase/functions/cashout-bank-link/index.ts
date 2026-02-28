import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createCheckbookBankLinkHandler } from "../_shared/checkbookCashout.ts";

export const config = { verify_jwt: false };

serve(
  createCheckbookBankLinkHandler({
    endpointName: "cashout-bank-link",
  }),
);
