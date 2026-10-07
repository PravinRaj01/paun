import { corsHeaders } from "./cors";
import type { Env, ExecutionContextLike, ScheduledEventLike } from "./env";
import { json } from "./http";
import { handleScan } from "./scan/handler";
import { readSpot, refreshSpot } from "./spot";

/**
 * paun-api: Paun's backend Worker (PLAN.md, "Backend: paun-api"). It is a separate Worker from the web app (`paun-web`),
 * deployed on its own, so a backend change never redeploys the site and the site never holds a backend secret.
 *
 * Endpoints: GET /health, GET /spot (the shared near-live price, from KV only), POST /scan (the receipt scanner).
 * Scheduled: the price refresh, weekdays every 15 minutes (see wrangler.jsonc).
 */
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
      headers: {
        ...cors,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400",
      },
    });
  }
  if (url.pathname === "/scan") {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { ...cors, allow: "POST, OPTIONS" });
    return handleScan(request, env, cors, now, fetchImpl);
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "method_not_allowed" }, 405, { ...cors, allow: "GET, HEAD, OPTIONS" });
  }
  if (url.pathname === "/health") {
    return json({ ok: true, service: "paun-api", time: now.toISOString() }, 200, cors);
  }
  if (url.pathname === "/spot") {
    const spot = await readSpot(env, now);
    if (!spot) return json({ error: "no_price_yet" }, 503, cors);
    // a minute at the edge: many visitors share one answer. The price only changes every 15 minutes anyway.
    return json(spot, 200, { ...cors, "cache-control": "public, max-age=60" });
  }
  return json({ error: "not_found" }, 404, cors);
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
  scheduled: (_event: ScheduledEventLike, env: Env, ctx: ExecutionContextLike) => {
    ctx.waitUntil(refreshSpot(env));
  },
};
