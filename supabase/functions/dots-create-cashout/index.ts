import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createDotsCashoutHandler } from "../_shared/dotsCashout.ts";

export const config = { verify_jwt: false };

serve(
  createDotsCashoutHandler({
    endpointName: "dots-create-cashout",
    requireIdempotencyKey: true,
  }),
);
