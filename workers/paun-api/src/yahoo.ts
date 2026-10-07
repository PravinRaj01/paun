/**
 * Latest gold futures price (GC=F, USD per troy ounce) from Yahoo Finance's public chart endpoint. No key.
 *
 * Yahoo's endpoint is unofficial: it can change shape, rate-limit, or block a data centre without notice, so every failure
 * is returned as a reason instead of thrown, and the caller decides what to do (PLAN.md 3B: fall back to the budgeted GoldAPI key).
 * It is the same instrument as the daily chart (GC=F), so the live number and the history agree.
 */
export type YahooResult =
  | { ok: true; priceUsdOz: number; marketTime: string; symbol: string; host: string; ms: number }
  | { ok: false; reason: string; status?: number; host: string; ms: number };

const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
const PATH = "/v8/finance/chart/GC=F?interval=1m&range=1d";
// a price outside this range is a parsing mistake or bad data, never a real gold price
const MIN_USD_OZ = 500;
const MAX_USD_OZ = 20_000;

export function parseYahooChart(body: unknown): { priceUsdOz: number; marketTime: string; symbol: string } | { error: string } {
  const result = (body as { chart?: { result?: unknown[] } } | null)?.chart?.result?.[0] as
    | { meta?: { regularMarketPrice?: unknown; regularMarketTime?: unknown; symbol?: unknown; currency?: unknown } }
    | undefined;
  const meta = result?.meta;
  if (!meta) return { error: "no_result" };
  const price = meta.regularMarketPrice;
  const time = meta.regularMarketTime;
  if (typeof price !== "number" || !Number.isFinite(price)) return { error: "no_price" };
  if (price < MIN_USD_OZ || price > MAX_USD_OZ) return { error: "price_out_of_range" };
  if (meta.currency !== undefined && meta.currency !== "USD") return { error: "not_usd" };
  if (typeof time !== "number" || !Number.isFinite(time) || time <= 0) return { error: "no_time" };
  return { priceUsdOz: price, marketTime: new Date(time * 1000).toISOString(), symbol: String(meta.symbol ?? "GC=F") };
}

/** Tries one Yahoo host; `host` lets the caller try the other when the first fails. */
export async function fetchYahooGold(host: string = HOSTS[0]!, fetchImpl: typeof fetch = fetch): Promise<YahooResult> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  try {
    const res = await fetchImpl(`https://${host}${PATH}`, {
      // Yahoo answers 429 / empty replies to requests with no browser-like User-Agent
      headers: { "user-agent": "Mozilla/5.0 (compatible; paun-api)", accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, reason: "http_error", status: res.status, host, ms: elapsed() };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, reason: "not_json", status: res.status, host, ms: elapsed() };
    }
    const parsed = parseYahooChart(body);
    if ("error" in parsed) return { ok: false, reason: parsed.error, status: res.status, host, ms: elapsed() };
    return { ok: true, ...parsed, host, ms: elapsed() };
  } catch (e) {
    return { ok: false, reason: e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network_error", host, ms: elapsed() };
  }
}

/** Both Yahoo hosts, in order, until one works. */
export async function fetchYahooGoldAny(fetchImpl: typeof fetch = fetch): Promise<YahooResult[]> {
  const attempts: YahooResult[] = [];
  for (const host of HOSTS) {
    const r = await fetchYahooGold(host, fetchImpl);
    attempts.push(r);
    if (r.ok) break;
  }
  return attempts;
}
