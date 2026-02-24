import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createTremendousCashoutHandler } from "../_shared/tremendousCashout.ts";

export const config = { verify_jwt: false };

serve(
  createTremendousCashoutHandler({
    endpointName: "tremendous-create-cashout",
    requireIdempotencyKey: true,
    allowVirtualBalanceFallback: false,
  }),
);
