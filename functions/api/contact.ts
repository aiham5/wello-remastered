interface Env {
  BREVO_API_KEY?: string;
  CONTACT_TO_EMAIL?: string;
  CONTACT_FROM_EMAIL?: string;
  CONTACT_FROM_NAME?: string;
  TURNSTILE_SECRET?: string;
}

interface ContactPayload {
  name?: string;
  businessName?: string;
  email?: string;
  phone?: string;
  issueType?: string;
  message?: string;
  website?: string;
  pageUrl?: string;
  userAgent?: string;
  turnstileToken?: string;
}

const ISSUE_LABELS: Record<string, string> = {
  onboarding: "Onboarding",
  account_access: "Account access",
  offer_management: "Offer management",
  redemptions: "Redemptions and verification",
  billing_payouts: "Billing and payouts",
  bug_report: "Bug report",
  other: "Other",
};

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 3;

type RateEntry = { count: number; startedAt: number };
const rateMap: Map<string, RateEntry> =
  (globalThis as { __welloContactRateMap?: Map<string, RateEntry> }).__welloContactRateMap ??
  new Map<string, RateEntry>();
(globalThis as { __welloContactRateMap?: Map<string, RateEntry> }).__welloContactRateMap = rateMap;

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });

const clean = (value: unknown, max = 2000) =>
  String(value ?? "")
    .trim()
    .slice(0, max);

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const clientIp = (request: Request) =>
  request.headers.get("cf-connecting-ip") ||
  request.headers.get("x-forwarded-for") ||
  "unknown";

const isRateLimited = (key: string) => {
  const now = Date.now();
  const current = rateMap.get(key);
  if (!current || now - current.startedAt > RATE_WINDOW_MS) {
    rateMap.set(key, { count: 1, startedAt: now });
    return false;
  }
  current.count += 1;
  rateMap.set(key, current);
  return current.count > RATE_MAX;
};

async function verifyTurnstile(request: Request, env: Env, token: string) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;

  const body = new URLSearchParams();
  body.set("secret", env.TURNSTILE_SECRET);
  body.set("response", token);
  const ip = clientIp(request);
  if (ip && ip !== "unknown") body.set("remoteip", ip);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  if (!response.ok) return false;
  const data = (await response.json()) as { success?: boolean };
  return Boolean(data?.success);
}

function renderEmailHtml(input: {
  name: string;
  businessName: string;
  email: string;
  phone: string;
  issueLabel: string;
  message: string;
  pageUrl: string;
  userAgent: string;
}) {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f2237">
      <h2 style="margin:0 0 12px 0;">New support request</h2>
      <p style="margin:0 0 8px 0;"><strong>Issue type:</strong> ${escapeHtml(input.issueLabel)}</p>
      <p style="margin:0 0 8px 0;"><strong>Name:</strong> ${escapeHtml(input.name)}</p>
      <p style="margin:0 0 8px 0;"><strong>Business:</strong> ${escapeHtml(input.businessName)}</p>
      <p style="margin:0 0 8px 0;"><strong>Email:</strong> ${escapeHtml(input.email)}</p>
      <p style="margin:0 0 8px 0;"><strong>Phone:</strong> ${escapeHtml(input.phone || "Not provided")}</p>
      <p style="margin:14px 0 6px 0;"><strong>Message</strong></p>
      <div style="padding:12px;border:1px solid #d5deea;border-radius:8px;background:#f7fbff;white-space:pre-wrap;">${escapeHtml(input.message)}</div>
      <p style="margin:14px 0 8px 0;"><strong>Technical</strong></p>
      <p style="margin:0 0 6px 0;"><strong>Page URL:</strong> ${escapeHtml(input.pageUrl || "Not provided")}</p>
      <p style="margin:0;"><strong>User agent:</strong> ${escapeHtml(input.userAgent || "Not provided")}</p>
    </div>
  `;
}

export const onRequestOptions = async () =>
  new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    },
  });

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  if (!env.BREVO_API_KEY) {
    return json(
      { error: "Support form is not configured yet. Please email support@wellopartners.com." },
      { status: 503 },
    );
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return json({ error: "Invalid request format." }, { status: 415 });
  }

  let payload: ContactPayload;
  try {
    payload = (await request.json()) as ContactPayload;
  } catch {
    return json({ error: "Invalid request body." }, { status: 400 });
  }

  const name = clean(payload.name, 100);
  const businessName = clean(payload.businessName, 120);
  const email = clean(payload.email, 160).toLowerCase();
  const phone = clean(payload.phone, 40);
  const issueType = clean(payload.issueType, 50);
  const message = clean(payload.message, 4000);
  const website = clean(payload.website, 250);
  const pageUrl = clean(payload.pageUrl, 800);
  const userAgent = clean(payload.userAgent, 500);
  const turnstileToken = clean(payload.turnstileToken, 1200);

  if (website) {
    return json({ ok: true });
  }

  if (!name || !businessName || !email || !issueType || !message) {
    return json({ error: "Please complete all required fields." }, { status: 400 });
  }
  if (!validEmail(email)) {
    return json({ error: "Please enter a valid email address." }, { status: 400 });
  }
  if (message.length < 10) {
    return json({ error: "Please provide a little more detail in your message." }, { status: 400 });
  }

  const rateKey = `${clientIp(request)}:${email}`;
  if (isRateLimited(rateKey)) {
    return json({ error: "Too many requests. Please wait a minute and try again." }, { status: 429 });
  }

  const turnstileOk = await verifyTurnstile(request, env, turnstileToken);
  if (!turnstileOk) {
    return json({ error: "Security check failed. Please refresh and try again." }, { status: 400 });
  }

  const issueLabel = ISSUE_LABELS[issueType] || "Other";
  const toEmail = env.CONTACT_TO_EMAIL || "support@wellopartners.com";
  const fromEmail = env.CONTACT_FROM_EMAIL || toEmail;
  const fromName = env.CONTACT_FROM_NAME || "Wello Support";
  const subject = `[Wello Support] ${issueLabel} - ${businessName}`;
  const textContent = [
    "New support request",
    "",
    `Issue type: ${issueLabel}`,
    `Name: ${name}`,
    `Business: ${businessName}`,
    `Email: ${email}`,
    `Phone: ${phone || "Not provided"}`,
    "",
    "Message:",
    message,
    "",
    `Page URL: ${pageUrl || "Not provided"}`,
    `User agent: ${userAgent || "Not provided"}`,
  ].join("\n");

  const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "api-key": env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: [{ email: toEmail }],
      replyTo: { email, name },
      subject,
      textContent,
      htmlContent: renderEmailHtml({
        name,
        businessName,
        email,
        phone,
        issueLabel,
        message,
        pageUrl,
        userAgent,
      }),
      tags: ["wello-contact-form"],
    }),
  });

  if (!brevoResponse.ok) {
    const detail = await brevoResponse.text();
    console.error("Contact send failed", brevoResponse.status, detail);
    return json(
      { error: "We could not send your message right now. Please try again shortly." },
      { status: 502 },
    );
  }

  return json({ ok: true });
};
