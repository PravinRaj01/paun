import { corsHeaders, type Env } from "./cors";
import { fetchYahooGoldAny } from "./yahoo";

/**
 * paun-api: Paun's backend Worker (PLAN.md, "Backend: paun-api"). It is a separate Worker from the web app (`paun-web`),
 * deployed on its own, so a backend change never redeploys the site and the site never holds a backend secret.
 *
 * Endpoints so far: GET /health, and a temporary GET /probe (phase 3b.4). Coming: GET /spot (phase 3b.5), POST /scan (item 4).
 */
const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });

// TEMPORARY (phase 3b.4, removed once the decision is made): can Yahoo be reached from Cloudflare's servers, and how fast?
// Answers are remembered for 30 s so that visitors cannot turn this route into a stream of requests to Yahoo.
let lastProbe: { at: number; body: unknown } | undefined;
async function probe(request: Request, now: Date, fetchImpl: typeof fetch): Promise<unknown> {
  if (lastProbe && now.getTime() - lastProbe.at < 30_000) return lastProbe.body;
  const attempts = await fetchYahooGoldAny(fetchImpl);
  const body = {
    ranAt: now.toISOString(),
    // which Cloudflare data centre ran this request (a scheduled run can happen in a different one)
    colo: (request as Request & { cf?: { colo?: string } }).cf?.colo ?? null,
    yahooOk: attempts.some((a) => a.ok),
    attempts,
  };
  lastProbe = { at: now.getTime(), body };
  return body;
}

export async function handle(
  request: Request,
  env: Env,
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  const cors = corsHeaders(request.headers.get("origin"), env);

  if (request.method === "OPTIONS") {
    // the browser's permission check before a cross-origin request
    return new Response(null, {
      status: 204,
      headers: { ...cors, "access-control-allow-methods": "GET, OPTIONS", "access-control-max-age": "86400" },
    });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "method_not_allowed" }, 405, { ...cors, allow: "GET, HEAD, OPTIONS" });
  }
  if (url.pathname === "/health") {
    return json({ ok: true, service: "paun-api", time: now.toISOString() }, 200, cors);
  }
  if (url.pathname === "/probe") {
    return json(await probe(request, now, fetchImpl), 200, cors);
  }
  return json({ error: "not_found" }, 404, cors);
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
};
