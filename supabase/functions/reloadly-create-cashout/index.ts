import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createReloadlyCashoutHandler } from "../_shared/reloadlyCashout.ts";

export const config = { verify_jwt: false };

serve(
  createReloadlyCashoutHandler({
    endpointName: "reloadly-create-cashout",
    requireIdempotencyKey: true,
  }),
);
