import { corsHeaders, type Env } from "./cors";

/**
 * paun-api: Paun's backend Worker (PLAN.md, "Backend: paun-api"). It is a separate Worker from the web app (`paun-web`),
 * deployed on its own, so a backend change never redeploys the site and the site never holds a backend secret.
 *
 * Endpoints so far: GET /health. Coming: GET /spot (phase 3b.5), POST /scan (item 4).
 */
const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });

export async function handle(request: Request, env: Env, now: Date = new Date()): Promise<Response> {
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
  return json({ error: "not_found" }, 404, cors);
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
};
