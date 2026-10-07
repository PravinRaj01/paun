import type { Env, KvLike } from "./env";

/**
 * Spending cap for the owner's GoldAPI key (100 calls a month on their plan).
 *
 * A call is RESERVED (the counter goes up) BEFORE it is made, so a call that fails or times out still counts: the worst case
 * is under-spending, never over-spending. Counters are per UTC month and per UTC day. KV is not atomic, but the only writer is
 * the cron job, which runs one at a time, so there is no race to lose.
 */
export const DEFAULT_MONTHLY_BUDGET = 90;
export const DEFAULT_DAILY_BUDGET = 3;

const monthKey = (now: Date) => `goldapi:month:${now.toISOString().slice(0, 7)}`;
const dayKey = (now: Date) => `goldapi:day:${now.toISOString().slice(0, 10)}`;

const limit = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};
const count = async (kv: KvLike, key: string) => {
  const n = Number(await kv.get(key));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export type Reservation = { ok: true; usedMonth: number; usedDay: number } | { ok: false; reason: "monthly_budget" | "daily_budget" };

export async function reserveGoldApiCall(env: Pick<Env, "SPOT" | "MONTHLY_BUDGET" | "DAILY_BUDGET">, now: Date): Promise<Reservation> {
  const month = await count(env.SPOT, monthKey(now));
  const day = await count(env.SPOT, dayKey(now));
  if (month >= limit(env.MONTHLY_BUDGET, DEFAULT_MONTHLY_BUDGET)) return { ok: false, reason: "monthly_budget" };
  if (day >= limit(env.DAILY_BUDGET, DEFAULT_DAILY_BUDGET)) return { ok: false, reason: "daily_budget" };
  await env.SPOT.put(monthKey(now), String(month + 1), { expirationTtl: 40 * 86_400 });
  await env.SPOT.put(dayKey(now), String(day + 1), { expirationTtl: 3 * 86_400 });
  return { ok: true, usedMonth: month + 1, usedDay: day + 1 };
}
