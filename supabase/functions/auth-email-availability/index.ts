import { createClient } from "npm:@supabase/supabase-js@2.40.0";

export const config = { verify_jwt: false };

const SUPABASE_URL =
  Deno.env.get("EDGE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("EDGE_SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("EDGE_SERVICE_ROLE_KEY") ??
  "";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const allowOrigin = (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const allowed = [
    "https://wellopartners.com",
    "https://www.wellopartners.com",
  ];
  if (allowed.includes(origin)) return origin;
  return "*";
};

const corsHeaders = (req: Request) => ({
  "Access-Control-Allow-Origin": allowOrigin(req),
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});

const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });

const createAdminClient = () =>
  createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const authUserExists = async (adminClient: any, email: string) => {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return { exists: false, error: null };

  let page = 1;
  const perPage = 200;
  const maxPages = 50;

  while (page <= maxPages) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) {
      return { exists: false, error: "Unable to verify email availability" };
    }

    const users = Array.isArray(data?.users) ? data.users : [];
    const found = users.some(
      (user: any) => String(user?.email || "").trim().toLowerCase() === normalized,
    );
    if (found) return { exists: true, error: null };

    if (users.length < perPage) break;
    page += 1;
  }

  return { exists: false, error: null };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json(req, 405, { error: "Method not allowed" });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(req, 500, { error: "Missing server configuration" });
  }

  const payload = await req.json().catch(() => ({}));
  const email = String(payload?.email || "")
    .trim()
    .toLowerCase();
  if (!email || !EMAIL_REGEX.test(email)) {
    return json(req, 400, { error: "Invalid email address" });
  }

  const adminClient = createAdminClient();

  const { data: profileRows, error: profileError } = await adminClient
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .limit(1);
  if (profileError) {
    return json(req, 500, { error: "Unable to verify email availability" });
  }
  if (Array.isArray(profileRows) && profileRows.length > 0) {
    return json(req, 200, {
      ok: true,
      available: false,
      reason: "already_registered",
    });
  }

  const authExists = await authUserExists(adminClient, email);
  if (authExists.error) {
    return json(req, 500, { error: authExists.error });
  }
  if (authExists.exists) {
    return json(req, 200, {
      ok: true,
      available: false,
      reason: "already_registered",
    });
  }

  return json(req, 200, {
    ok: true,
    available: true,
  });
});
