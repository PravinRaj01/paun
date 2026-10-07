import { reserveGoldApiCall } from "./budget";
import type { Env } from "./env";
import { fetchGoldApi } from "./goldapi";
import { fetchYahooGoldAny } from "./yahoo";

/**
 * The shared near-live gold price for the landing page (PLAN.md 3B).
 *
 *  - `refreshSpot` runs from the cron trigger (weekdays, every 15 minutes). It asks Yahoo; only if Yahoo fails AND the stored
 *    price is already stale does it spend one budgeted GoldAPI call. The result is written to KV.
 *  - `readSpot` serves `GET /spot` from KV only. It never contacts a provider, so visitors cannot use up any quota.
 *
 * Times: `fetchedAt` and `marketTime` are real moments (ISO, UTC); the browser shows them in the viewer's own timezone.
 */
export type Provider = "yahoo" | "goldapi";

export type StoredSpot = {
  priceUsdOz: number;
  fetchedAt: string; // when this Worker got the price
  marketTime: string | null; // when the provider says the price was struck (null if it did not say)
  provider: Provider;
};

export type SpotResponse = StoredSpot & {
  ageSeconds: number; // now - fetchedAt
  marketOpen: boolean | null; // price struck within the last 30 min; null when the provider gave no time
  stale: boolean; // the refresh job looks broken: no new price for 45+ min on a weekday
};

const KEY = "spot:latest";
/** Yahoo failed: only then, and only if the stored price is older than this, may the backup be paid for. */
export const BACKUP_AFTER_MS = 30 * 60_000;
export const STALE_AFTER_MS = 45 * 60_000;
const OPEN_WITHIN_MS = 30 * 60_000;

export async function loadSpot(env: Pick<Env, "SPOT">): Promise<StoredSpot | null> {
  const raw = await env.SPOT.get(KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredSpot>;
    if (typeof v.priceUsdOz !== "number" || typeof v.fetchedAt !== "string" || (v.provider !== "yahoo" && v.provider !== "goldapi")) return null;
    return { priceUsdOz: v.priceUsdOz, fetchedAt: v.fetchedAt, marketTime: v.marketTime ?? null, provider: v.provider };
  } catch {
    return null;
  }
}

const save = (env: Pick<Env, "SPOT">, spot: StoredSpot) => env.SPOT.put(KEY, JSON.stringify(spot));

/** One cron run. Returns what happened (also logged: status and timings only, never a key or a body). */
export async function refreshSpot(env: Env, now: Date = new Date(), fetchImpl: typeof fetch = fetch): Promise<string> {
  const attempts = await fetchYahooGoldAny(fetchImpl);
  const yahoo = attempts.find((a) => a.ok);
  if (yahoo?.ok) {
    await save(env, { priceUsdOz: yahoo.priceUsdOz, fetchedAt: now.toISOString(), marketTime: yahoo.marketTime, provider: "yahoo" });
    return log(`spot: yahoo ok (${yahoo.ms} ms)`);
  }
  const why = attempts.map((a) => (a.ok ? "ok" : `${a.reason}${a.status ? ` ${a.status}` : ""}`)).join(", ");

  const stored = await loadSpot(env);
  if (stored && now.getTime() - Date.parse(stored.fetchedAt) < BACKUP_AFTER_MS) {
    return log(`spot: yahoo failed (${why}); stored price is recent, backup not used`);
  }
  if (!env.GOLDAPI_KEY?.trim()) return log(`spot: yahoo failed (${why}); no GOLDAPI_KEY set`);
  const slot = await reserveGoldApiCall(env, now);
  if (!slot.ok) return log(`spot: yahoo failed (${why}); backup not used (${slot.reason})`);

  const backup = await fetchGoldApi(env.GOLDAPI_KEY, fetchImpl);
  if (!backup.ok) return log(`spot: yahoo failed (${why}); goldapi failed (${backup.reason}${backup.status ? ` ${backup.status}` : ""}), call ${slot.usedMonth} this month`);
  await save(env, { priceUsdOz: backup.priceUsdOz, fetchedAt: now.toISOString(), marketTime: backup.marketTime, provider: "goldapi" });
  return log(`spot: goldapi ok (${backup.ms} ms), call ${slot.usedMonth} this month, ${slot.usedDay} today`);
}

const log = (line: string) => (console.log(line), line);

/** Gold futures trade Sunday evening to Friday evening (UTC), and the cron only runs Monday to Friday. */
const isWeekday = (d: Date) => d.getUTCDay() >= 1 && d.getUTCDay() <= 5;

export async function readSpot(env: Pick<Env, "SPOT">, now: Date = new Date()): Promise<SpotResponse | null> {
  const s = await loadSpot(env);
  if (!s) return null;
  const age = Math.max(0, now.getTime() - Date.parse(s.fetchedAt));
  const struck = s.marketTime ? Date.parse(s.marketTime) : NaN;
  return {
    ...s,
    ageSeconds: Math.round(age / 1000),
    marketOpen: Number.isFinite(struck) ? now.getTime() - struck <= OPEN_WITHIN_MS : null,
    stale: age > STALE_AFTER_MS && isWeekday(now),
  };
}
