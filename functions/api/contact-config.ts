interface Env {
  TURNSTILE_SITE_KEY?: string;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });

export const onRequestGet = async ({ env }: { env: Env }) => {
  const turnstileSiteKey = String(env.TURNSTILE_SITE_KEY || "").trim();
  return json({ turnstileSiteKey });
};
