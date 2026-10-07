/**
 * The owner's GoldAPI key, used ONLY as a budgeted backup when Yahoo fails (PLAN.md 3B). The plan allows 100 calls a month,
 * so this module never decides whether to call: `budget.ts` does. The same request the app makes with a user's own key
 * (`fetchLiveSpot` in src/lib/gold.ts). The key is sent to goldapi.io and nowhere else, and never appears in a result or a log.
 */
export type GoldApiResult =
  | { ok: true; priceUsdOz: number; marketTime: string | null; ms: number }
  | { ok: false; reason: string; status?: number; ms: number };

const MIN_USD_OZ = 500;
const MAX_USD_OZ = 20_000;

export async function fetchGoldApi(key: string, fetchImpl: typeof fetch = fetch): Promise<GoldApiResult> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  try {
    const res = await fetchImpl("https://www.goldapi.io/api/XAU/USD", {
      headers: { "x-access-token": key.trim(), accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    // 403 = bad key, 429 = plan limit reached; either way nothing in the body is worth keeping
    if (!res.ok) return { ok: false, reason: "http_error", status: res.status, ms: elapsed() };
    const data = (await res.json().catch(() => null)) as { price?: unknown; timestamp?: unknown } | null;
    const price = Number(data?.price);
    if (!Number.isFinite(price) || price <= 0) return { ok: false, reason: "no_price", status: res.status, ms: elapsed() };
    if (price < MIN_USD_OZ || price > MAX_USD_OZ) return { ok: false, reason: "price_out_of_range", status: res.status, ms: elapsed() };
    const ts = Number(data?.timestamp);
    return {
      ok: true,
      priceUsdOz: price,
      marketTime: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null,
      ms: elapsed(),
    };
  } catch (e) {
    return { ok: false, reason: e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network_error", ms: elapsed() };
  }
}
