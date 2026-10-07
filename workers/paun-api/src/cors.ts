/**
 * Which browser origins may call this Worker. A request from any other origin still gets an answer, but without the
 * CORS headers, so the browser refuses to hand it to the page. (The Worker holds no secret a GET could leak; the
 * allow-list keeps other sites from building on our endpoints and, later, from spending our quotas through a visitor's browser.)
 */
export type Env = {
  /** Comma-separated extra origins, e.g. a custom domain added later: "https://paun.example". Plain variable, no secret. */
  EXTRA_ORIGINS?: string;
};

const WEB_ORIGIN = "https://paun-web.paun-gold.workers.dev";
// Cloudflare names a branch preview "<branch>-paun-web.<subdomain>.workers.dev"
const PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+-paun-web\.paun-gold\.workers\.dev$/;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

export function isAllowedOrigin(origin: string | null, env: Env): origin is string {
  if (!origin) return false;
  if (origin === WEB_ORIGIN || PREVIEW_ORIGIN.test(origin) || LOCAL_ORIGIN.test(origin)) return true;
  return (env.EXTRA_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)
    .includes(origin);
}

export function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  return isAllowedOrigin(origin, env)
    ? { "access-control-allow-origin": origin, vary: "Origin" }
    : { vary: "Origin" };
}
