import { getAdminContext, json, logAuthEvent } from "../../_lib/auth.js";

const ALLOWED_TABLES = new Set([
  "admin_action_logs",
  "admin_auth_events",
  "business_review_audit_log",
  "businesses",
  "cashback_events",
  "cashout_payouts",
  "commission_events",
  "dots_webhook_events",
  "offers",
  "plaid_event_logs",
  "plaid_webhook_events",
  "profiles",
  "promo_codes",
  "purchase_verifications",
  "receipt_reports",
  "receipt_uploads",
  "redemptions",
  "stripe_webhook_events",
  "tremendous_webhook_events",
]);

const ALLOWED_MUTATION_TABLES = new Set([
  "businesses",
  "offers",
  "profiles",
  "promo_codes",
  "receipt_reports",
  "receipt_uploads",
]);

const ALLOWED_RPCS = new Set([
  "admin_review_receipt",
  "admin_preview_receipt_outcome",
  "admin_update_receipt_decision",
  "admin_update_receipt_report",
  "admin_review_business",
  "admin_review_offer",
  "admin_update_user_role",
]);

const ALLOWED_FUNCTIONS = new Set([
  "admin-run-monthly-invoices",
  "admin-add-commission-to-stripe",
  "admin-send-promo-push",
]);

const parseJson = async (request) => {
  try {
    return await request.json();
  } catch {
    return {};
  }
};

const parseCount = (response) => {
  const header = String(response.headers.get("content-range") || "");
  const countPart = header.split("/")[1] || "";
  const count = Number(countPart);
  return Number.isFinite(count) ? count : 0;
};

const parseResponseBody = async (response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
};

const r2EncodeRfc3986 = (value) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const r2EncodePath = (path) =>
  String(path || "")
    .split("/")
    .map((segment) => r2EncodeRfc3986(segment))
    .join("/");

const toHex = (buffer) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const hmacRaw = async (key, value) => {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(value),
  );
  return new Uint8Array(signature);
};

const getSigningKey = async (secret, dateStamp, region, service) => {
  const encoder = new TextEncoder();
  const kDate = await hmacRaw(encoder.encode(`AWS4${secret}`), dateStamp);
  const kRegion = await hmacRaw(kDate, region);
  const kService = await hmacRaw(kRegion, service);
  return hmacRaw(kService, "aws4_request");
};

const sha256Hex = async (value) =>
  toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

const buildQueryString = (params) => {
  const keys = Object.keys(params).sort();
  return keys
    .map((key) => `${r2EncodeRfc3986(key)}=${r2EncodeRfc3986(params[key])}`)
    .join("&");
};

const createR2PresignedUrl = async ({ endpoint, bucket, accessKeyId, secretAccessKey, key, expiresIn }) => {
  const cleanEndpoint = String(endpoint || "").replace(/\/+$/, "");
  const url = new URL(cleanEndpoint);
  const host = url.host;
  const basePath =
    url.pathname && url.pathname !== "/" ? url.pathname.replace(/\/+$/, "") : "";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const credential = `${accessKeyId}/${credentialScope}`;
  const canonicalUri = basePath
    ? `${basePath}/${r2EncodePath(key)}`
    : `/${r2EncodePath(`${bucket}/${key}`)}`;
  const payloadHash = "UNSIGNED-PAYLOAD";

  const queryParams = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": "host",
  };

  const canonicalQueryString = buildQueryString(queryParams);
  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    "host",
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await getSigningKey(secretAccessKey, dateStamp, "auto", "s3");
  const signature = toHex(await hmacRaw(signingKey, stringToSign));
  const finalQuery = `${canonicalQueryString}&X-Amz-Signature=${signature}`;

  return `${cleanEndpoint}${canonicalUri}?${finalQuery}`;
};

const signR2DownloadUrl = async (env, key, expiresIn) => {
  const endpoint = String(env.R2_ENDPOINT || env.ADMIN_R2_ENDPOINT || "").trim();
  const bucket = String(env.R2_BUCKET || env.ADMIN_R2_BUCKET || "").trim();
  const accessKeyId = String(env.R2_ACCESS_KEY_ID || env.ADMIN_R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(
    env.R2_SECRET_ACCESS_KEY || env.ADMIN_R2_SECRET_ACCESS_KEY || "",
  ).trim();

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 is not configured on admin runtime.");
  }

  return createR2PresignedUrl({
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    key,
    expiresIn,
  });
};

const applyQuerySpec = ({ url, spec, toPostgrestFilter }) => {
  if (spec.select) url.searchParams.set("select", String(spec.select));

  if (Array.isArray(spec.filters)) {
    spec.filters.forEach((entry) => {
      const item = toPostgrestFilter(entry?.column, entry?.op, entry?.value);
      if (!item) return;
      const [key, value] = item;
      if (key === "or") {
        url.searchParams.set("or", String(value));
      } else {
        url.searchParams.append(key, String(value));
      }
    });
  }

  if (Array.isArray(spec.order) && spec.order.length > 0) {
    const orderValue = spec.order
      .map((entry) => {
        const column = String(entry?.column || "").trim();
        if (!column) return null;
        const direction = entry?.ascending === false ? "desc" : "asc";
        const nulls = entry?.nullsFirst === true ? "nullsfirst" : "nullslast";
        return `${column}.${direction}.${nulls}`;
      })
      .filter(Boolean)
      .join(",");
    if (orderValue) url.searchParams.set("order", orderValue);
  }

  if (Number.isFinite(Number(spec.limit)) && Number(spec.limit) > 0) {
    url.searchParams.set("limit", String(Math.trunc(Number(spec.limit))));
  }
};

const handleQuery = async (ctx, spec) => {
  const table = String(spec?.table || "").trim();
  const action = String(spec?.action || "select").trim().toLowerCase();
  if (!ALLOWED_TABLES.has(table)) {
    return json({ ok: false, error: { code: "table_not_allowed", message: "Table is not allowed." } }, 403);
  }

  const url = new URL(`/rest/v1/${table}`, "https://supabase.local");
  applyQuerySpec({ url, spec, toPostgrestFilter: ctx.toPostgrestFilter });

  const headers = {};
  let method = "GET";
  let body = undefined;

  if (action === "select") {
    if (spec?.selectOptions?.count) {
      headers.Prefer = `count=${spec.selectOptions.count}`;
    }
    if (spec?.selectOptions?.head === true) {
      method = "HEAD";
      headers.Prefer = headers.Prefer ? `${headers.Prefer},count=exact` : "count=exact";
    }
  } else if (action === "insert") {
    if (!ALLOWED_MUTATION_TABLES.has(table)) {
      return json(
        {
          ok: false,
          error: {
            code: "table_write_not_allowed",
            message: "Write access is not allowed on this table.",
          },
        },
        403,
      );
    }
    method = "POST";
    headers.Prefer = "return=representation";
    body = JSON.stringify(spec?.body ?? {});
  } else if (action === "update") {
    if (!ALLOWED_MUTATION_TABLES.has(table)) {
      return json(
        {
          ok: false,
          error: {
            code: "table_write_not_allowed",
            message: "Write access is not allowed on this table.",
          },
        },
        403,
      );
    }
    if (!Array.isArray(spec?.filters) || spec.filters.length === 0) {
      return json(
        {
          ok: false,
          error: {
            code: "unsafe_update_blocked",
            message: "Update requests require explicit filters.",
          },
        },
        400,
      );
    }
    method = "PATCH";
    headers.Prefer = "return=representation";
    body = JSON.stringify(spec?.body ?? {});
  } else {
    return json({ ok: false, error: { code: "action_not_allowed", message: "Action is not allowed." } }, 400);
  }

  if (spec?.range && Number.isFinite(Number(spec.range.from)) && Number.isFinite(Number(spec.range.to))) {
    headers.Range = `${Math.max(0, Math.trunc(Number(spec.range.from)))}-${Math.max(0, Math.trunc(Number(spec.range.to)))}`;
  }

  const response = await ctx.supabaseRequest(`${url.pathname}${url.search}`, {
    method,
    headers,
    body,
  });

  const parsedBody = await parseResponseBody(response);
  if (!response.ok) {
    return json(
      {
        ok: false,
        error: {
          code: "supabase_query_failed",
          message: String(parsedBody?.message || parsedBody?.error_description || parsedBody?.error || "Supabase query failed."),
          status: response.status,
        },
      },
      response.status,
    );
  }

  let data = parsedBody;
  if (method === "HEAD") data = [];

  if (spec.single === "maybe") {
    const rows = Array.isArray(data) ? data : [];
    data = rows[0] || null;
  }

  if (spec.single === "single") {
    const rows = Array.isArray(data) ? data : [];
    if (rows.length !== 1) {
      return json({ ok: false, error: { code: "single_row_expected", message: "Expected single row." } }, 409);
    }
    data = rows[0];
  }

  const normalizedData =
    spec.single === "single" || spec.single === "maybe"
      ? data ?? null
      : Array.isArray(data)
        ? data
        : data == null
          ? []
          : [data];

  return json({ ok: true, data: normalizedData, count: parseCount(response) }, 200);
};

const handleRpc = async (ctx, body) => {
  const name = String(body?.name || "").trim();
  const args = body?.args && typeof body.args === "object" ? body.args : {};
  if (!ALLOWED_RPCS.has(name)) {
    return json({ ok: false, error: { code: "rpc_not_allowed", message: "RPC is not allowed." } }, 403);
  }

  const toIsoOrNull = (value) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  };

  const normalizeStatus = (value) => String(value || "").trim().toLowerCase();

  const selectRows = async ({ table, select = "*", filters = [], limit = 100 }) => {
    const url = new URL(`/rest/v1/${table}`, "https://supabase.local");
    url.searchParams.set("select", select);
    if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
      url.searchParams.set("limit", String(Math.trunc(Number(limit))));
    }

    for (const filter of filters) {
      const item = ctx.toPostgrestFilter(filter.column, filter.op, filter.value);
      if (!item) continue;
      const [key, value] = item;
      if (key === "or") url.searchParams.set("or", String(value));
      else url.searchParams.append(key, String(value));
    }

    const response = await ctx.supabaseRequest(`${url.pathname}${url.search}`);
    const parsed = await parseResponseBody(response);
    if (!response.ok) {
      return {
        rows: [],
        error: {
          status: response.status,
          message: String(parsed?.message || "Select failed."),
        },
      };
    }

    return {
      rows: Array.isArray(parsed) ? parsed : [],
      error: null,
    };
  };

  const selectOne = async (spec) => {
    const result = await selectRows({ ...spec, limit: 1 });
    return {
      row: result.rows[0] || null,
      error: result.error,
    };
  };

  const insertOne = async ({ table, payload, select = "id" }) => {
    const url = new URL(`/rest/v1/${table}`, "https://supabase.local");
    url.searchParams.set("select", select);
    const response = await ctx.supabaseRequest(`${url.pathname}${url.search}`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    const parsed = await parseResponseBody(response);
    if (!response.ok) {
      return {
        row: null,
        error: {
          status: response.status,
          message: String(parsed?.message || "Insert failed."),
        },
      };
    }
    return {
      row: Array.isArray(parsed) ? parsed[0] || null : null,
      error: null,
    };
  };

  const logAction = async ({ action, entity, entityId, status = "success", before = null, after = null, meta = {} }) => {
    const payload = {
      actor_id: String(ctx.profile?.id || ""),
      actor_role: String(ctx.profile?.role || ""),
      action: String(action || "unknown"),
      entity: String(entity || "unknown"),
      entity_id: entityId || null,
      status: status === "failed" ? "failed" : "success",
      before_state: before,
      after_state: after,
      meta: meta && typeof meta === "object" ? meta : {},
    };
    await insertOne({
      table: "admin_action_logs",
      payload,
      select: "id",
    });
  };

  const updateOne = async ({ table, updates, filters, select = "*" }) => {
    const url = new URL(`/rest/v1/${table}`, "https://supabase.local");
    url.searchParams.set("select", select);
    for (const filter of filters) {
      const item = ctx.toPostgrestFilter(filter.column, filter.op, filter.value);
      if (!item) continue;
      const [key, value] = item;
      if (key === "or") {
        url.searchParams.set("or", String(value));
      } else {
        url.searchParams.append(key, String(value));
      }
    }
    const response = await ctx.supabaseRequest(`${url.pathname}${url.search}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=representation",
      },
      body: JSON.stringify(updates),
    });
    const parsed = await parseResponseBody(response);
    if (!response.ok) {
      return {
        row: null,
        error: {
          status: response.status,
          message: String(parsed?.message || "RPC emulation update failed."),
        },
      };
    }
    const row = Array.isArray(parsed) ? parsed[0] || null : null;
    return { row, error: null };
  };

  if (name === "admin_preview_receipt_outcome") {
    const receiptId = String(args.p_receipt_id || "").trim();
    const totalCents = Number(args.p_receipt_total_cents || 0);
    if (!receiptId) {
      return json({ ok: false, error: { code: "invalid_receipt_id", message: "Receipt id is required." } }, 400);
    }
    if (!Number.isFinite(totalCents) || totalCents <= 0) {
      return json({ ok: false, error: { code: "invalid_receipt_total", message: "Receipt total must be greater than 0." } }, 400);
    }

    const receiptRes = await selectOne({
      table: "receipt_uploads",
      select: "id,business_id,promo_code_id",
      filters: [{ column: "id", op: "eq", value: receiptId }],
    });
    if (receiptRes.error) {
      return json({ ok: false, error: { code: "rpc_failed", message: receiptRes.error.message, status: receiptRes.error.status } }, receiptRes.error.status);
    }
    if (!receiptRes.row?.id) {
      return json({ ok: false, error: { code: "receipt_not_found", message: "Receipt not found." } }, 404);
    }

    let commissionRateCents = 150;
    const businessId = String(receiptRes.row.business_id || "").trim();
    if (businessId) {
      const businessRes = await selectOne({
        table: "businesses",
        select: "id,commission_rate_cents",
        filters: [{ column: "id", op: "eq", value: businessId }],
      });
      if (!businessRes.error && businessRes.row?.id) {
        const candidate = Number(businessRes.row.commission_rate_cents || 0);
        if ([100, 150].includes(candidate)) commissionRateCents = candidate;
      }
    }
    const commissionRateBps = commissionRateCents * 10;

    let defaultCashbackRateBps = 750;
    const settingsRes = await selectOne({
      table: "app_settings",
      select: "key,value_json",
      filters: [{ column: "key", op: "eq", value: "consumer_cashback_rate_bps" }],
    });
    if (!settingsRes.error && settingsRes.row?.value_json) {
      const parsedBps = Number(settingsRes.row.value_json?.bps || 0);
      if (Number.isFinite(parsedBps) && parsedBps > 0) defaultCashbackRateBps = parsedBps;
    }

    const commissionCents = Math.floor((totalCents * commissionRateBps) / 10000);

    const promoCodeId = receiptRes.row.promo_code_id || null;
    let appliedPromoRateBps = null;
    let appliedPromoCode = null;
    if (promoCodeId) {
      const promoRes = await selectOne({
        table: "promo_codes",
        select: "id,code,cashback_rate_bps",
        filters: [{ column: "id", op: "eq", value: promoCodeId }],
      });
      if (!promoRes.error && promoRes.row?.id) {
        const rate = Number(promoRes.row.cashback_rate_bps || 0);
        if (rate > 0) {
          appliedPromoRateBps = rate;
          appliedPromoCode = String(promoRes.row.code || "").trim() || null;
        }
      }
    }

    const effectiveCashbackRateBps = appliedPromoRateBps || defaultCashbackRateBps;
    const cashbackCents = Math.floor((totalCents * effectiveCashbackRateBps) / 10000);
    const platformSubsidyCents = Math.max(cashbackCents - commissionCents, 0);

    return json({
      ok: true,
      data: {
        receipt_id: receiptRes.row.id,
        commission_rate_cents: commissionRateCents,
        commission_rate_bps: commissionRateBps,
        commission_cents: commissionCents,
        default_cashback_rate_bps: defaultCashbackRateBps,
        applied_promo_code_id: appliedPromoRateBps ? promoCodeId : null,
        applied_promo_code: appliedPromoCode,
        applied_promo_rate_bps: appliedPromoRateBps,
        effective_cashback_rate_bps: effectiveCashbackRateBps,
        cashback_basis: "receipt_total",
        cashback_cents: cashbackCents,
        platform_subsidy_cents: platformSubsidyCents,
      },
    });
  }

  if (name === "admin_update_receipt_decision") {
    const receiptId = String(args.p_receipt_id || "").trim();
    const action = normalizeStatus(args.p_action);
    const expectedStatus = normalizeStatus(args.p_expected_status);
    const expectedReviewedAtIso = toIsoOrNull(args.p_expected_reviewed_at);
    const totalCentsRaw = args.p_receipt_total_cents;
    const totalCents = totalCentsRaw == null ? null : Number(totalCentsRaw);
    const notes = args.p_review_notes == null ? null : String(args.p_review_notes);

    if (!receiptId) {
      return json({ ok: false, error: { code: "invalid_receipt_id", message: "Receipt id is required." } }, 400);
    }
    if (!["verify", "reject", "undo", "edit"].includes(action)) {
      return json({ ok: false, error: { code: "invalid_action", message: "Invalid receipt action." } }, 400);
    }
    if (!["pending", "verified", "rejected"].includes(expectedStatus)) {
      return json({ ok: false, error: { code: "missing_expected_status", message: "Expected status is required." } }, 400);
    }
    if (["verify", "edit"].includes(action) && (!Number.isFinite(totalCents) || totalCents <= 0)) {
      return json({ ok: false, error: { code: "invalid_receipt_total", message: "Receipt total must be greater than 0." } }, 400);
    }

    const currentRes = await selectOne({
      table: "receipt_uploads",
      select: "id,review_status,review_notes,reviewed_by,reviewed_at,receipt_total_cents,redemption_id",
      filters: [{ column: "id", op: "eq", value: receiptId }],
    });
    if (currentRes.error) {
      return json({ ok: false, error: { code: "rpc_failed", message: currentRes.error.message, status: currentRes.error.status } }, currentRes.error.status);
    }
    const current = currentRes.row;
    if (!current?.id) {
      return json({ ok: false, error: { code: "receipt_not_found", message: "Receipt not found." } }, 404);
    }

    const currentStatus = normalizeStatus(current.review_status);
    const currentReviewedAtIso = toIsoOrNull(current.reviewed_at);
    if (currentStatus !== expectedStatus) {
      return json({ ok: false, error: { code: "concurrency_conflict", reason: "status_mismatch", message: "Receipt changed. Refresh and retry." } }, 409);
    }
    if ((currentReviewedAtIso || null) !== (expectedReviewedAtIso || null)) {
      return json({ ok: false, error: { code: "concurrency_conflict", reason: "reviewed_at_mismatch", message: "Receipt changed. Refresh and retry." } }, 409);
    }

    if ((action === "verify" || action === "reject") && currentStatus !== "pending") {
      return json({ ok: false, error: { code: "invalid_transition", message: "Only pending receipts can be reviewed." } }, 409);
    }
    if (action === "undo" && !["verified", "rejected"].includes(currentStatus)) {
      return json({ ok: false, error: { code: "invalid_transition", message: "Only verified/rejected receipts can be undone." } }, 409);
    }
    if (action === "edit" && currentStatus !== "verified") {
      return json({ ok: false, error: { code: "invalid_transition", message: "Only verified receipts can be edited." } }, 409);
    }

    if (action === "undo" || action === "edit") {
      const [commissionLockRes, cashbackLockRes] = await Promise.all([
        selectOne({
          table: "commission_events",
          select: "id,status",
          filters: [
            { column: "redemption_id", op: "eq", value: current.redemption_id },
            { column: "status", op: "in", value: "(invoiced,paid)" },
          ],
        }),
        selectOne({
          table: "cashback_events",
          select: "id,status",
          filters: [
            { column: "receipt_upload_id", op: "eq", value: current.id },
            { column: "status", op: "eq", value: "paid" },
          ],
        }),
      ]);

      if (commissionLockRes.error) {
        return json({ ok: false, error: { code: "rpc_failed", message: commissionLockRes.error.message, status: commissionLockRes.error.status } }, commissionLockRes.error.status);
      }
      if (cashbackLockRes.error) {
        return json({ ok: false, error: { code: "rpc_failed", message: cashbackLockRes.error.message, status: cashbackLockRes.error.status } }, cashbackLockRes.error.status);
      }
      if (commissionLockRes.row?.id || cashbackLockRes.row?.id) {
        return json({
          ok: false,
          error: {
            code: "receipt_locked",
            reason: "accounting_progressed",
            message: "This receipt is locked because invoicing/payout has already progressed.",
          },
        }, 409);
      }
    }

    const nowIso = new Date().toISOString();
    const updates = {};
    if (action === "verify") {
      updates.review_status = "verified";
      updates.receipt_total_cents = Math.trunc(totalCents);
      updates.review_notes = notes;
      updates.reviewed_by = ctx.profile.id;
      updates.reviewed_at = nowIso;
    } else if (action === "reject") {
      updates.review_status = "rejected";
      updates.review_notes = notes;
      updates.reviewed_by = ctx.profile.id;
      updates.reviewed_at = nowIso;
    } else if (action === "undo") {
      updates.review_status = "pending";
      updates.review_notes = notes;
      updates.reviewed_by = null;
      updates.reviewed_at = null;
    } else {
      updates.receipt_total_cents = Math.trunc(totalCents);
      updates.review_notes = notes;
      updates.reviewed_by = ctx.profile.id;
      updates.reviewed_at = nowIso;
    }

    const filters = [
      { column: "id", op: "eq", value: receiptId },
      { column: "review_status", op: "eq", value: expectedStatus },
    ];
    if (expectedReviewedAtIso) {
      filters.push({ column: "reviewed_at", op: "eq", value: expectedReviewedAtIso });
    } else {
      filters.push({ column: "reviewed_at", op: "is", value: null });
    }

    const result = await updateOne({
      table: "receipt_uploads",
      updates,
      filters,
      select: "id,review_status,review_notes,reviewed_by,reviewed_at,receipt_total_cents,business_id,redemption_id,user_id,uploaded_at,storage_path,promo_code_id",
    });
    if (result.error) {
      return json({ ok: false, error: { code: "rpc_failed", message: result.error.message, status: result.error.status } }, result.error.status);
    }
    if (!result.row?.id) {
      return json({ ok: false, error: { code: "concurrency_conflict", reason: "stale_update", message: "Receipt changed. Refresh and retry." } }, 409);
    }

    await logAction({
      action:
        action === "verify"
          ? "receipt_verified"
          : action === "reject"
            ? "receipt_rejected"
            : action === "undo"
              ? "receipt_undone"
              : "receipt_edited",
      entity: "receipt_uploads",
      entityId: receiptId,
      before: {
        review_status: current.review_status,
        receipt_total_cents: current.receipt_total_cents,
        review_notes: current.review_notes,
        reviewed_by: current.reviewed_by,
        reviewed_at: current.reviewed_at,
      },
      after: {
        review_status: result.row.review_status,
        receipt_total_cents: result.row.receipt_total_cents,
        review_notes: result.row.review_notes,
        reviewed_by: result.row.reviewed_by,
        reviewed_at: result.row.reviewed_at,
      },
      meta: { action },
    });

    return json({ ok: true, data: result.row }, 200);
  }

  if (name === "admin_review_receipt") {
    const receiptId = String(args.p_receipt_id || "").trim();
    const nextStatus = String(args.p_review_status || "").trim();
    const totalCents = Number(args.p_receipt_total_cents || 0);
    if (!receiptId) {
      return json({ ok: false, error: { code: "invalid_receipt_id", message: "Receipt id is required." } }, 400);
    }
    if (!["verified", "rejected"].includes(nextStatus)) {
      return json({ ok: false, error: { code: "invalid_review_status", message: "Invalid review status." } }, 400);
    }
    if (nextStatus === "verified" && (!Number.isFinite(totalCents) || totalCents <= 0)) {
      return json({ ok: false, error: { code: "invalid_receipt_total", message: "Invalid receipt total." } }, 400);
    }
    const updates = {
      review_status: nextStatus,
      review_notes: args.p_review_notes ?? null,
      reviewed_by: args.p_reviewed_by || ctx.profile.id,
      reviewed_at: new Date().toISOString(),
    };
    if (nextStatus === "verified") {
      updates.receipt_total_cents = Math.trunc(totalCents);
    }
    const result = await updateOne({
      table: "receipt_uploads",
      updates,
      filters: [
        { column: "id", op: "eq", value: receiptId },
        { column: "review_status", op: "eq", value: "pending" },
      ],
    });
    if (result.error) {
      return json({ ok: false, error: { code: "rpc_failed", message: result.error.message, status: result.error.status } }, result.error.status);
    }
    return json({ ok: true, data: result.row }, 200);
  }

  if (name === "admin_update_receipt_report") {
    const reportId = String(args.p_report_id || "").trim();
    const nextStatus = String(args.p_status || "").trim();
    if (!reportId) {
      return json({ ok: false, error: { code: "invalid_report_id", message: "Report id is required." } }, 400);
    }
    if (!["reviewing", "resolved", "dismissed"].includes(nextStatus)) {
      return json({ ok: false, error: { code: "invalid_report_status", message: "Invalid report status." } }, 400);
    }
    const resolved = nextStatus === "resolved" || nextStatus === "dismissed";
    const result = await updateOne({
      table: "receipt_reports",
      updates: {
        status: nextStatus,
        resolution_notes: args.p_resolution_notes ?? null,
        resolved_by: resolved ? args.p_resolved_by || ctx.profile.id : null,
        resolved_at: resolved ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      filters: [
        { column: "id", op: "eq", value: reportId },
        { column: "status", op: "in", value: "(open,reviewing)" },
      ],
    });
    if (result.error) {
      return json({ ok: false, error: { code: "rpc_failed", message: result.error.message, status: result.error.status } }, result.error.status);
    }
    return json({ ok: true, data: result.row }, 200);
  }

  if (name === "admin_review_business") {
    const businessId = String(args.p_business_id || "").trim();
    const nextStatus = String(args.p_next_approval_status || "").trim();
    if (!businessId) {
      return json({ ok: false, error: { code: "invalid_business_id", message: "Business id is required." } }, 400);
    }
    if (!["approved", "rejected"].includes(nextStatus)) {
      return json({ ok: false, error: { code: "invalid_business_status", message: "Invalid business status." } }, 400);
    }
    const result = await updateOne({
      table: "businesses",
      updates: {
        approval_status: nextStatus,
        status: nextStatus === "approved" ? "active" : "inactive",
        updated_at: new Date().toISOString(),
      },
      filters: [
        { column: "id", op: "eq", value: businessId },
        { column: "approval_status", op: "eq", value: "pending" },
      ],
    });
    if (result.error) {
      return json({ ok: false, error: { code: "rpc_failed", message: result.error.message, status: result.error.status } }, result.error.status);
    }
    return json({ ok: true, data: result.row }, 200);
  }

  if (name === "admin_review_offer") {
    const offerId = String(args.p_offer_id || "").trim();
    const nextStatus = String(args.p_next_approval_status || "").trim();
    if (!offerId) {
      return json({ ok: false, error: { code: "invalid_offer_id", message: "Offer id is required." } }, 400);
    }
    if (!["approved", "rejected"].includes(nextStatus)) {
      return json({ ok: false, error: { code: "invalid_offer_status", message: "Invalid offer status." } }, 400);
    }
    const result = await updateOne({
      table: "offers",
      updates: {
        approval_status: nextStatus,
        active: nextStatus === "approved",
        updated_at: new Date().toISOString(),
      },
      filters: [
        { column: "id", op: "eq", value: offerId },
        { column: "approval_status", op: "eq", value: "pending" },
      ],
    });
    if (result.error) {
      return json({ ok: false, error: { code: "rpc_failed", message: result.error.message, status: result.error.status } }, result.error.status);
    }
    return json({ ok: true, data: result.row }, 200);
  }

  if (name === "admin_update_user_role") {
    const profileId = String(args.p_profile_id || "").trim();
    const expectedRole = String(args.p_expected_role || "").trim();
    const nextRole = String(args.p_next_role || "").trim();
    if (!profileId) {
      return json({ ok: false, error: { code: "invalid_profile_id", message: "Profile id is required." } }, 400);
    }
    if (!["consumer", "business_owner", "supervisor", "admin"].includes(nextRole)) {
      return json({ ok: false, error: { code: "invalid_role", message: "Invalid role." } }, 400);
    }
    if (profileId === String(ctx.profile.id || "")) {
      return json({ ok: false, error: { code: "self_role_change_blocked", message: "Self-role changes are blocked." } }, 400);
    }
    const filters = [{ column: "id", op: "eq", value: profileId }];
    if (expectedRole) {
      filters.push({ column: "role", op: "eq", value: expectedRole });
    }
    const result = await updateOne({
      table: "profiles",
      updates: {
        role: nextRole,
        updated_at: new Date().toISOString(),
      },
      filters,
    });
    if (result.error) {
      return json({ ok: false, error: { code: "rpc_failed", message: result.error.message, status: result.error.status } }, result.error.status);
    }
    return json({ ok: true, data: result.row }, 200);
  }

  return json({ ok: false, error: { code: "rpc_not_implemented", message: "RPC is not implemented." } }, 400);
};

const handleStorageSign = async (ctx, body) => {
  const bucket = String(body?.bucket || "").trim();
  const path = String(body?.path || "").trim().replace(/^\/+/, "");
  const expiresIn = Math.max(60, Math.min(24 * 60 * 60, Math.trunc(Number(body?.expiresIn || 1800))));

  if (!bucket || !path) {
    return json({ ok: false, error: { code: "invalid_storage_input", message: "Bucket and path are required." } }, 400);
  }

  if (bucket === "__r2__" || path.startsWith("receipts/")) {
    if (!path.startsWith("receipts/")) {
      return json(
        {
          ok: false,
          error: {
            code: "invalid_r2_key",
            message: "R2 receipt keys must start with 'receipts/'.",
          },
        },
        400,
      );
    }
    try {
      const signedUrl = await signR2DownloadUrl(ctx.env, path, expiresIn);
      return json({ ok: true, data: { signedUrl, signedURL: signedUrl, provider: "r2" } }, 200);
    } catch (error) {
      return json(
        {
          ok: false,
          error: {
            code: "r2_sign_failed",
            message: String(error?.message || "Unable to sign R2 URL."),
          },
        },
        500,
      );
    }
  }

  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  const response = await ctx.supabaseRequest(
    `/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodedPath}`,
    {
      method: "POST",
      body: JSON.stringify({ expiresIn }),
    },
  );

  const parsed = await parseResponseBody(response);
  if (!response.ok) {
    return json({ ok: false, error: { code: "storage_sign_failed", message: String(parsed?.message || "Unable to sign storage URL."), status: response.status } }, response.status);
  }

  const supabaseUrl = String(ctx.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const signedPath = String(parsed?.signedURL || parsed?.signedUrl || "");
  const signedUrl = signedPath.startsWith("http") ? signedPath : `${supabaseUrl}/storage/v1${signedPath}`;

  return json({ ok: true, data: { signedUrl, signedURL: signedUrl } }, 200);
};

const handleInvokeFunction = async (ctx, fnName, body) => {
  if (!ALLOWED_FUNCTIONS.has(fnName)) {
    return json({ ok: false, error: { code: "function_not_allowed", message: "Function is not allowed." } }, 403);
  }

  const supabaseUrl = String(ctx.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(
    ctx.env.ADMIN_SUPABASE_SECRET_KEY ||
      ctx.env.SUPABASE_SECRET_KEY ||
      ctx.env.SUPABASE_SERVICE_ROLE_KEY ||
      "",
  ).trim();
  if (!key) {
    return json(
      {
        ok: false,
        error: {
          code: "missing_server_secret",
          message: "Server secret is not configured.",
        },
      },
      500,
    );
  }
  const response = await fetch(`${supabaseUrl}/functions/v1/${encodeURIComponent(fnName)}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });

  const parsed = await parseResponseBody(response);
  if (!response.ok) {
    return json({ ok: false, error: { code: "edge_function_failed", message: String(parsed?.message || parsed?.error || `Function ${fnName} failed.`), status: response.status } }, response.status);
  }

  return json({ ok: true, data: parsed ?? null }, 200);
};

const handleLogAction = async (ctx, body) => {
  const payload = {
    actor_id: String(ctx.profile?.id || ""),
    actor_role: String(ctx.profile?.role || ""),
    action: String(body?.action || "unknown"),
    entity: String(body?.entity || "unknown"),
    entity_id: body?.entityId || null,
    status: String(body?.status || "success") === "failed" ? "failed" : "success",
    before_state: body?.before ?? null,
    after_state: body?.after ?? null,
    meta: body?.meta && typeof body.meta === "object" ? body.meta : {},
  };

  const response = await ctx.supabaseRequest(`/rest/v1/admin_action_logs`, {
    method: "POST",
    headers: {
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const parsed = await parseResponseBody(response);
    return json({ ok: false, error: { code: "log_action_failed", message: String(parsed?.message || "Unable to log admin action."), status: response.status } }, response.status);
  }

  const rows = await parseResponseBody(response);
  const row = Array.isArray(rows) ? rows[0] || null : rows;
  return json({ ok: true, data: { logged: Boolean(row?.id), id: row?.id || null } }, 200);
};

const handleOverview = async (ctx) => {
  const queries = [
    { key: "pendingReceipts", table: "receipt_uploads", filter: ["review_status", "eq.pending"] },
    { key: "openReports", table: "receipt_reports", filter: ["status", "in.(open,reviewing)"] },
    { key: "pendingBusinesses", table: "businesses", filter: ["approval_status", "eq.pending"] },
    { key: "pendingOffers", table: "offers", filter: ["approval_status", "eq.pending"] },
    { key: "pendingCashouts", table: "cashout_payouts", filter: ["status", "eq.pending"] },
  ];

  const counts = {};
  for (const item of queries) {
    const response = await ctx.supabaseRequest(`/rest/v1/${item.table}?select=id&${item.filter[0]}=${encodeURIComponent(item.filter[1])}`, {
      method: "HEAD",
      headers: {
        Prefer: "count=exact",
      },
    });
    counts[item.key] = response.ok ? parseCount(response) : 0;
  }

  return json({ ok: true, data: counts }, 200);
};

const routeExplicit = async (ctx, request, segments) => {
  const method = request.method.toUpperCase();
  const body = method === "GET" ? {} : await parseJson(request);

  if (segments.length === 1 && segments[0] === "me" && method === "GET") {
    return json({ ok: true, data: { user: { id: ctx.profile.id, email: ctx.profile.email }, profile: ctx.profile } }, 200);
  }

  if (segments.length === 1 && segments[0] === "overview" && method === "GET") {
    return handleOverview(ctx);
  }

  if (segments.length === 1 && segments[0] === "query" && method === "POST") {
    return handleQuery(ctx, body || {});
  }

  if (segments.length === 1 && segments[0] === "rpc" && method === "POST") {
    return handleRpc(ctx, body || {});
  }

  if (segments.length === 2 && segments[0] === "storage" && segments[1] === "sign" && method === "POST") {
    return handleStorageSign(ctx, body || {});
  }

  if (segments.length === 2 && segments[0] === "functions" && method === "POST") {
    const fnName = decodeURIComponent(segments[1]);
    return handleInvokeFunction(ctx, fnName, body || {});
  }

  if (segments.length === 1 && segments[0] === "log-action" && method === "POST") {
    return handleLogAction(ctx, body || {});
  }

  if (segments.length === 1 && segments[0] === "receipts" && method === "GET") {
    const searchParams = new URL(request.url).searchParams;
    const status = String(searchParams.get("status") || "pending").trim().toLowerCase();
    const businessId = String(searchParams.get("businessId") || "all").trim();
    const search = String(searchParams.get("search") || "").trim();
    const startDate = String(searchParams.get("startDate") || "").trim();
    const endDate = String(searchParams.get("endDate") || "").trim();
    const page = Math.max(0, Number(searchParams.get("page") || 0) || 0);
    const pageSize = Math.max(1, Math.min(100, Number(searchParams.get("pageSize") || 30) || 30));
    const filters = [];

    if (["pending", "verified", "rejected"].includes(status)) {
      filters.push({ column: "review_status", op: "eq", value: status });
    }
    if (businessId && businessId !== "all") {
      filters.push({ column: "business_id", op: "eq", value: businessId });
    }
    if (startDate) {
      filters.push({ column: "uploaded_at", op: "gte", value: `${startDate}T00:00:00.000Z` });
    }
    if (endDate) {
      filters.push({ column: "uploaded_at", op: "lte", value: `${endDate}T23:59:59.999Z` });
    }
    if (search) {
      const safe = search.replace(/,/g, " ");
      filters.push({ column: "or", op: "or", value: `id.ilike.%${safe}%,review_notes.ilike.%${safe}%` });
    }

    return handleQuery(ctx, {
      table: "receipt_uploads",
      action: "select",
      select:
        "id,uploaded_at,storage_path,receipt_total_cents,commission_due_cents,review_status,review_notes,reviewed_at,reviewed_by,business_id,redemption_id,user_id,promo_code_id,business:businesses(id,name,commission_rate_cents),redemption:redemptions(id,offer:offers(id,title))",
      order: [{ column: "uploaded_at", ascending: false }],
      limit: pageSize,
      range: {
        from: page * pageSize,
        to: page * pageSize + pageSize - 1,
      },
      single: "none",
      filters,
    });
  }

  if (segments.length === 3 && segments[0] === "receipts" && segments[2] === "detail" && method === "GET") {
    return handleQuery(ctx, {
      table: "receipt_uploads",
      action: "select",
      select:
        "id,uploaded_at,storage_path,receipt_total_cents,commission_due_cents,review_status,review_notes,reviewed_at,reviewed_by,business_id,redemption_id,user_id,promo_code_id,business:businesses(id,name,commission_rate_cents),redemption:redemptions(id,offer:offers(id,title),commission_events(id,amount_cents,status)),promo_code:promo_codes(id,code,cashback_rate_bps),cashback_events(id,amount_cents,status,cashback_rate_bps,cashback_basis,platform_subsidy_cents,promo_code_id,promo_code:promo_codes(code,cashback_rate_bps))",
      filters: [{ column: "id", op: "eq", value: segments[1] }],
      single: "maybe",
    });
  }

  if (segments.length === 3 && segments[0] === "receipts" && segments[2] === "preview" && method === "POST") {
    return handleRpc(ctx, {
      name: "admin_preview_receipt_outcome",
      args: {
        p_receipt_id: segments[1],
        p_receipt_total_cents: body?.receiptTotalCents,
      },
    });
  }

  if (segments.length === 3 && segments[0] === "receipts" && segments[2] === "decision" && method === "POST") {
    return handleRpc(ctx, {
      name: "admin_update_receipt_decision",
      args: {
        p_receipt_id: segments[1],
        p_action: body?.action,
        p_receipt_total_cents: body?.receiptTotalCents,
        p_review_notes: body?.reviewNotes ?? null,
        p_expected_status: body?.expectedStatus,
        p_expected_reviewed_at: body?.expectedReviewedAt ?? null,
      },
    });
  }

  if (segments.length === 3 && segments[0] === "receipts" && segments[2] === "review" && method === "POST") {
    return handleRpc(ctx, {
      name: "admin_review_receipt",
      args: {
        p_receipt_id: segments[1],
        p_receipt_total_cents: body?.receiptTotalCents,
        p_review_status: body?.reviewStatus,
        p_review_notes: body?.reviewNotes || null,
        p_reviewed_by: body?.reviewedBy || ctx.profile.id,
      },
    });
  }

  if (segments.length === 1 && segments[0] === "receipt-reports" && method === "GET") {
    return handleQuery(ctx, {
      table: "receipt_reports",
      action: "select",
      select:
        "id,receipt_upload_id,business_id,reporter_id,reason,details,status,resolution_notes,resolved_by,resolved_at,created_at,updated_at,business:businesses(id,name),receipt:receipt_uploads(id,review_status,uploaded_at,receipt_total_cents)",
      order: [{ column: "created_at", ascending: false }],
      limit: Number(new URL(request.url).searchParams.get("limit") || 30),
      filters: [],
    });
  }

  if (segments.length === 3 && segments[0] === "receipt-reports" && segments[2] === "status" && method === "POST") {
    return handleRpc(ctx, {
      name: "admin_update_receipt_report",
      args: {
        p_report_id: segments[1],
        p_status: body?.status,
        p_resolution_notes: body?.resolutionNotes || null,
        p_resolved_by: body?.resolvedBy || ctx.profile.id,
      },
    });
  }

  if (segments.length === 1 && segments[0] === "businesses" && method === "GET") {
    return handleQuery(ctx, {
      table: "businesses",
      action: "select",
      select: "id,name,owner_id,category_label,approval_status,status,created_at,updated_at",
      order: [{ column: "created_at", ascending: true }],
      limit: Number(new URL(request.url).searchParams.get("limit") || 30),
      filters: [],
    });
  }

  if (segments.length === 3 && segments[0] === "businesses" && segments[2] === "review" && method === "POST") {
    return handleRpc(ctx, {
      name: "admin_review_business",
      args: {
        p_business_id: segments[1],
        p_next_approval_status: body?.nextApprovalStatus,
      },
    });
  }

  if (segments.length === 1 && segments[0] === "offers" && method === "GET") {
    return handleQuery(ctx, {
      table: "offers",
      action: "select",
      select: "id,business_id,title,description,offer_type,active,approval_status,created_at,business:businesses(id,name)",
      order: [{ column: "created_at", ascending: true }],
      limit: Number(new URL(request.url).searchParams.get("limit") || 30),
      filters: [],
    });
  }

  if (segments.length === 3 && segments[0] === "offers" && segments[2] === "review" && method === "POST") {
    return handleRpc(ctx, {
      name: "admin_review_offer",
      args: {
        p_offer_id: segments[1],
        p_next_approval_status: body?.nextApprovalStatus,
      },
    });
  }

  if (segments.length === 2 && segments[0] === "offers" && segments[1] === "review-bulk" && method === "POST") {
    const ids = Array.isArray(body?.offerIds) ? body.offerIds.map(String) : [];
    const nextApprovalStatus = String(body?.nextApprovalStatus || "").trim();
    const results = [];
    for (const offerId of ids) {
      const result = await handleRpc(ctx, {
        name: "admin_review_offer",
        args: { p_offer_id: offerId, p_next_approval_status: nextApprovalStatus },
      });
      const parsed = await result.json();
      results.push({ offerId, ok: parsed?.ok === true, data: parsed?.data || null, error: parsed?.error || null });
    }
    return json({ ok: true, data: { results } }, 200);
  }

  if (segments.length === 1 && segments[0] === "cashouts" && method === "GET") {
    const searchParams = new URL(request.url).searchParams;
    const status = String(searchParams.get("status") || "all").trim().toLowerCase();
    const provider = String(searchParams.get("provider") || "all").trim().toLowerCase();
    const search = String(searchParams.get("search") || "").trim();
    const page = Math.max(0, Number(searchParams.get("page") || 0) || 0);
    const limit = Math.max(1, Math.min(100, Number(searchParams.get("limit") || 30) || 30));
    const filters = [];
    if (status !== "all") filters.push({ column: "status", op: "eq", value: status });
    if (provider !== "all") filters.push({ column: "provider", op: "eq", value: provider });
    if (search) {
      const safe = search.replace(/,/g, " ");
      filters.push({
        column: "or",
        op: "or",
        value: `id.ilike.%${safe}%,user_id.ilike.%${safe}%,provider_order_id.ilike.%${safe}%,provider_reward_id.ilike.%${safe}%`,
      });
    }

    return handleQuery(ctx, {
      table: "cashout_payouts",
      action: "select",
      select:
        "id,user_id,amount_cents,status,provider,provider_status,provider_order_id,provider_reward_id,provider_claim_url,stripe_transfer_id,created_at,updated_at",
      order: [{ column: "created_at", ascending: false }],
      limit,
      range: {
        from: page * limit,
        to: page * limit + limit - 1,
      },
      filters,
    });
  }

  if (segments.length === 1 && segments[0] === "users" && method === "GET") {
    return handleQuery(ctx, {
      table: "profiles",
      action: "select",
      select: "id,email,full_name,role,created_at,updated_at",
      order: [{ column: "created_at", ascending: false }],
      limit: Number(new URL(request.url).searchParams.get("limit") || 30),
      filters: [],
    });
  }

  if (segments.length === 3 && segments[0] === "users" && segments[2] === "role" && method === "POST") {
    return handleRpc(ctx, {
      name: "admin_update_user_role",
      args: {
        p_profile_id: segments[1],
        p_expected_role: body?.expectedRole,
        p_next_role: body?.nextRole,
      },
    });
  }

  if (segments.length === 1 && segments[0] === "events" && method === "GET") {
    const [adminActionsRes, adminAuthRes, auditRes, stripeRes, plaidRes, dotsRes, tremendousRes, plaidEventsRes] = await Promise.all([
      handleQuery(ctx, { table: "admin_action_logs", action: "select", select: "id,action,entity,status,entity_id,meta,created_at", order: [{ column: "created_at", ascending: false }], limit: 100, filters: [] }),
      handleQuery(ctx, { table: "admin_auth_events", action: "select", select: "id,event_name,endpoint,actor_email,actor_role,outcome,reason,status_code,created_at,metadata", order: [{ column: "created_at", ascending: false }], limit: 100, filters: [] }),
      handleQuery(ctx, { table: "business_review_audit_log", action: "select", select: "id,previous_approval_status,next_approval_status,business_id,changed_at", order: [{ column: "changed_at", ascending: false }], limit: 100, filters: [] }),
      handleQuery(ctx, { table: "stripe_webhook_events", action: "select", select: "id,stripe_event_id,event_type,processed,processed_at,created_at", order: [{ column: "created_at", ascending: false }], limit: 100, filters: [] }),
      handleQuery(ctx, { table: "plaid_webhook_events", action: "select", select: "id,webhook_type,webhook_code,plaid_item_id,created_at", order: [{ column: "created_at", ascending: false }], limit: 100, filters: [] }),
      handleQuery(ctx, { table: "dots_webhook_events", action: "select", select: "id,event_id,event_type,processed,processed_at,created_at", order: [{ column: "created_at", ascending: false }], limit: 100, filters: [] }),
      handleQuery(ctx, { table: "tremendous_webhook_events", action: "select", select: "id,event_uuid,event_type,processed,processed_at,created_at", order: [{ column: "created_at", ascending: false }], limit: 100, filters: [] }),
      handleQuery(ctx, { table: "plaid_event_logs", action: "select", select: "id,source_function,event_name,severity,user_id,plaid_item_id,created_at,metadata", order: [{ column: "created_at", ascending: false }], limit: 100, filters: [] }),
    ]);

    const parse = async (res) => {
      const payload = await res.json();
      return payload?.ok ? payload.data || [] : [];
    };

    return json(
      {
        ok: true,
        data: {
          adminActions: await parse(adminActionsRes),
          adminAuthEvents: await parse(adminAuthRes),
          businessAudit: await parse(auditRes),
          stripeHooks: await parse(stripeRes),
          plaidHooks: await parse(plaidRes),
          dotsHooks: await parse(dotsRes),
          tremendousHooks: await parse(tremendousRes),
          plaidEvents: await parse(plaidEventsRes),
        },
      },
      200,
    );
  }

  if (segments.length === 1 && segments[0] === "promotions" && method === "GET") {
    return handleQuery(ctx, {
      table: "promo_codes",
      action: "select",
      select: "id,code,cashback_rate_bps,max_uses_per_user,active,starts_at,ends_at,created_at,updated_at",
      order: [{ column: "created_at", ascending: false }],
      limit: 200,
      filters: [],
    });
  }

  if (segments.length === 1 && segments[0] === "promotions" && method === "POST") {
    return handleQuery(ctx, {
      table: "promo_codes",
      action: "insert",
      body: body || {},
      select: "id",
      filters: [],
      single: "maybe",
    });
  }

  if (segments.length === 3 && segments[0] === "promotions" && segments[2] === "status" && method === "POST") {
    return handleQuery(ctx, {
      table: "promo_codes",
      action: "update",
      body: {
        active: Boolean(body?.active),
        updated_at: new Date().toISOString(),
      },
      select: "id",
      filters: [{ op: "eq", column: "id", value: segments[1] }],
      single: "maybe",
    });
  }

  if (segments.length === 2 && segments[0] === "promotions" && segments[1] === "push" && method === "POST") {
    return handleInvokeFunction(ctx, "admin-send-promo-push", body || {});
  }

  if (segments.length === 2 && segments[0] === "billing" && segments[1] === "run-monthly" && method === "POST") {
    return handleInvokeFunction(ctx, "admin-run-monthly-invoices", body || {});
  }

  if (segments.length === 2 && segments[0] === "billing" && segments[1] === "add-commission" && method === "POST") {
    return handleInvokeFunction(ctx, "admin-add-commission-to-stripe", body || {});
  }

  return json({ ok: false, error: { code: "not_found", message: "Endpoint not found." } }, 404);
};

export const onRequest = async (context) => {
  const { request, env } = context;
  const corsOrigin = String(env.ADMIN_CORS_ORIGIN || "").trim() || "*";

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": corsOrigin,
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,Cf-Access-Jwt-Assertion",
        "cache-control": "no-store",
      },
    });
  }

  let ctx = null;
  const url = new URL(request.url);
  const segments = url.pathname
    .replace(/^\/api\/admin\/?/, "")
    .split("/")
    .filter(Boolean);

  try {
    ctx = await getAdminContext(request, env);
    ctx.env = env;
    const response = await routeExplicit(ctx, request, segments);
    await logAuthEvent(ctx, {
      outcome: response.status >= 400 ? "failure" : "success",
      eventName: "api_request",
      endpoint: url.pathname,
      statusCode: response.status,
      metadata: { method: request.method },
    });
    return response;
  } catch (error) {
    const message = String(error?.message || "Unauthorized");
    const status = message.toLowerCase().includes("access denied") ? 403 : 401;
    const publicMessage = status === 403 ? "Access denied." : "Unauthorized.";

    if (ctx) {
      await logAuthEvent(ctx, {
        outcome: "failure",
        eventName: "api_request",
        endpoint: url.pathname,
        statusCode: status,
        reason: message,
        metadata: { method: request.method },
      });
    }

    return json(
      {
        ok: false,
        error: {
          code: status === 403 ? "forbidden" : "unauthorized",
          message: publicMessage,
        },
      },
      status,
    );
  }
};
