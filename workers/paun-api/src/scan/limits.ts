import type { Env, KvLike } from "../env";

/**
 * Who may scan, and how much. Two caps, both kept in KV:
 *  - a global daily cap (every scan costs a little real money, so a runaway cannot become a bill), and
 *  - a per-visitor hourly limit. There are no accounts, so a visitor is a hash of their IP address (the address itself is never stored).
 * The caps are CHECKED before the Turnstile token is spent and the AI is called, and RESERVED (counted) just before the AI call,
 * so a call that fails still counts: the worst case is refusing a few scans too early, never paying for too many.
 */
export const DEFAULT_DAILY_CAP = 200;
export const DEFAULT_PER_VISITOR_HOUR = 10;

type LimitEnv = Pick<Env, "SPOT" | "SCAN_DAILY_CAP" | "SCAN_PER_VISITOR_HOUR">;

const limit = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};
const count = async (kv: KvLike, key: string) => {
  const n = Number(await kv.get(key));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

async function visitorId(ip: string | null): Promise<string> {
  const bytes = new TextEncoder().encode(`paun-scan|${ip ?? "unknown"}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

const dayKey = (now: Date) => `scan:day:${now.toISOString().slice(0, 10)}`;
const hourKey = (id: string, now: Date) => `scan:ip:${id}:${now.toISOString().slice(0, 13)}`;

export type LimitCheck = { ok: true; reserve: () => Promise<void> } | { ok: false; reason: "scanner_busy" | "rate_limited" };

export async function checkScanLimits(env: LimitEnv, ip: string | null, now: Date): Promise<LimitCheck> {
  const id = await visitorId(ip);
  const day = await count(env.SPOT, dayKey(now));
  const hour = await count(env.SPOT, hourKey(id, now));
  if (day >= limit(env.SCAN_DAILY_CAP, DEFAULT_DAILY_CAP)) return { ok: false, reason: "scanner_busy" };
  if (hour >= limit(env.SCAN_PER_VISITOR_HOUR, DEFAULT_PER_VISITOR_HOUR)) return { ok: false, reason: "rate_limited" };
  return {
    ok: true,
    reserve: async () => {
      await env.SPOT.put(dayKey(now), String(day + 1), { expirationTtl: 3 * 86_400 });
      await env.SPOT.put(hourKey(id, now), String(hour + 1), { expirationTtl: 2 * 3600 });
    },
  };
}
