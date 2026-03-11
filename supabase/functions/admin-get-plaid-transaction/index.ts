import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.40.0";
import {
  plaidGetAccounts,
  plaidGetTransactions,
  type PlaidAccount,
  type PlaidTransaction,
} from "../_shared/plaid.ts";

export const config = { verify_jwt: false };

const SUPABASE_URL =
  Deno.env.get("EDGE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVER_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("EDGE_SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("EDGE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SECRET_KEY") ??
  Deno.env.get("ADMIN_SUPABASE_SECRET_KEY") ??
  "";
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("EDGE_SUPABASE_ANON_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-admin-actor-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const createAdminClient = () =>
  createClient(SUPABASE_URL, SUPABASE_SERVER_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const createAuthClient = () =>
  createClient(SUPABASE_URL, SUPABASE_ANON_KEY || SUPABASE_SERVER_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const toDateOnly = (value: string | null | undefined) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const addDays = (dateInput: string, days: number) => {
  const parsed = new Date(`${dateInput}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return dateInput;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

async function requireStaff(req: Request) {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const actorId = String(req.headers.get("x-admin-actor-id") || "").trim();
  const admin = createAdminClient();

  if (actorId && token && token === SUPABASE_SERVER_KEY) {
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, role")
      .eq("id", actorId)
      .maybeSingle();

    if (profileError || !profile) return { ok: false as const, status: 403, error: "Forbidden." };
    const role = String((profile as { role?: string | null })?.role || "");
    if (!["admin", "supervisor"].includes(role)) {
      return { ok: false as const, status: 403, error: "Forbidden." };
    }
    return { ok: true as const, admin };
  }

  if (!token) return { ok: false as const, status: 401, error: "Missing authorization." };

  const authClient = createAuthClient();
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData?.user?.id) {
    return { ok: false as const, status: 401, error: "Invalid JWT." };
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError || !profile) return { ok: false as const, status: 403, error: "Forbidden." };
  const role = String((profile as { role?: string | null })?.role || "");
  if (!["admin", "supervisor"].includes(role)) {
    return { ok: false as const, status: 403, error: "Forbidden." };
  }
  return { ok: true as const, admin };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!SUPABASE_URL || !SUPABASE_SERVER_KEY) {
    return json(500, { error: "Missing server configuration." });
  }

  try {
    const staff = await requireStaff(req);
    if (!staff.ok) return json(staff.status, { error: staff.error });
    const admin = staff.admin;

    const body = await req.json().catch(() => ({}));
    const reportId = String(body?.reportId || "").trim();
    if (!reportId) return json(400, { error: "Missing reportId." });

    const { data: report, error: reportError } = await admin
      .from("receipt_reports")
      .select("id, receipt_upload_id")
      .eq("id", reportId)
      .maybeSingle();
    if (reportError) return json(500, { error: reportError.message || "Unable to load report." });
    if (!report?.id) return json(404, { error: "Report not found." });

    const receiptId = String((report as { receipt_upload_id?: string | null })?.receipt_upload_id || "").trim();
    if (!receiptId) return json(200, { ok: true, data: null });

    const { data: receipt, error: receiptError } = await admin
      .from("receipt_uploads")
      .select("id, redemption_id")
      .eq("id", receiptId)
      .maybeSingle();
    if (receiptError) return json(500, { error: receiptError.message || "Unable to load receipt." });

    const redemptionId = String((receipt as { redemption_id?: string | null })?.redemption_id || "").trim();
    if (!redemptionId) return json(200, { ok: true, data: null });

    const { data: verification, error: verificationError } = await admin
      .from("purchase_verifications")
      .select(
        "id, matched_plaid_item_id, matched_plaid_transaction_id, matched_posted_on, expected_posted_on",
      )
      .eq("redemption_id", redemptionId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (verificationError) {
      return json(500, { error: verificationError.message || "Unable to load verification record." });
    }

    const plaidItemId = String((verification as { matched_plaid_item_id?: string | null })?.matched_plaid_item_id || "").trim();
    const transactionId = String((verification as { matched_plaid_transaction_id?: string | null })?.matched_plaid_transaction_id || "").trim();
    const matchedDate = toDateOnly((verification as { matched_posted_on?: string | null })?.matched_posted_on);
    const expectedDate = toDateOnly((verification as { expected_posted_on?: string | null })?.expected_posted_on);
    if (!plaidItemId || !transactionId) return json(200, { ok: true, data: null });

    const { data: linkedItem, error: linkedItemError } = await admin
      .from("plaid_linked_items")
      .select("plaid_item_id, plaid_access_token, institution_name")
      .eq("plaid_item_id", plaidItemId)
      .maybeSingle();
    if (linkedItemError) return json(500, { error: linkedItemError.message || "Unable to load linked item." });
    const accessToken = String((linkedItem as { plaid_access_token?: string | null })?.plaid_access_token || "").trim();
    if (!accessToken) return json(200, { ok: true, data: null });

    const anchorDate = matchedDate || expectedDate || new Date().toISOString().slice(0, 10);
    const windows = [
      { start: addDays(anchorDate, -14), end: addDays(anchorDate, 14) },
      { start: addDays(anchorDate, -90), end: addDays(anchorDate, 14) },
    ];

    let transaction: PlaidTransaction | null = null;
    let requestId: string | null = null;
    for (const window of windows) {
      const response = await plaidGetTransactions(accessToken, window.start, window.end);
      requestId = response.requestId || requestId;
      transaction = (Array.isArray(response.transactions) ? response.transactions : []).find(
        (row) => String(row?.transaction_id || "").trim() === transactionId,
      ) || null;
      if (transaction) break;
    }

    if (!transaction) {
      return json(200, {
        ok: true,
        data: {
          transactionId,
          plaidItemId,
          institutionName: String((linkedItem as { institution_name?: string | null })?.institution_name || "").trim() || null,
          requestId,
          notFound: true,
        },
      });
    }

    let account: PlaidAccount | null = null;
    try {
      const accountsResponse = await plaidGetAccounts(accessToken);
      account = (Array.isArray(accountsResponse.accounts) ? accountsResponse.accounts : []).find(
        (row) => String(row?.account_id || "").trim() === String(transaction?.account_id || "").trim(),
      ) || null;
    } catch {
      account = null;
    }

    return json(200, {
      ok: true,
      data: {
        transactionId: transaction.transaction_id,
        plaidItemId,
        requestId,
        institutionName: String((linkedItem as { institution_name?: string | null })?.institution_name || "").trim() || null,
        amount: Number(transaction.amount || 0),
        date: transaction.date || null,
        authorizedDate: transaction.authorized_date || null,
        pending: Boolean(transaction.pending),
        merchantName: String(transaction.merchant_name || "").trim() || null,
        name: String(transaction.name || "").trim() || null,
        account: account
          ? {
            name: String(account.name || "").trim() || null,
            officialName: String(account.official_name || "").trim() || null,
            mask: String(account.mask || "").trim() || null,
            subtype: String(account.subtype || "").trim() || null,
            type: String(account.type || "").trim() || null,
          }
          : null,
      },
    });
  } catch (error) {
    console.error("admin-get-plaid-transaction failed", error);
    return json(500, {
      error: "Internal Server Error",
      message: String((error as { message?: string })?.message || error || "unknown"),
    });
  }
});
