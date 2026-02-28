import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { disabledCashoutEndpoint } from "../_shared/cashoutDisabled.ts";

export const config = { verify_jwt: false };

serve(
  disabledCashoutEndpoint("giftbit", "giftbit-create-cashout"),
);
