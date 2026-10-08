import type { KvLike } from "./env";

/**
 * Small shared helpers for "per visitor, per hour" limits. There are no accounts to key on, so a visitor is a hash of their IP address
 * (the address itself is never stored). The counters live in KV with a short expiry.
 */
export async function visitorId(ip: string | null, salt = "paun-scan"): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}|${ip ?? "unknown"}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Counts one attempt in `bucket` for this visitor and says whether it is allowed (at most `max` per UTC hour).
 * KV is not atomic, but a visitor's own requests are nearly sequential, so a rare extra attempt slipping through is acceptable here.
 */
export async function allowHourly(kv: KvLike, bucket: string, ip: string | null, max: number, now: Date): Promise<boolean> {
  const key = `rate:${bucket}:${await visitorId(ip, bucket)}:${now.toISOString().slice(0, 13)}`;
  const used = Number(await kv.get(key));
  const n = Number.isFinite(used) && used > 0 ? used : 0;
  if (n >= max) return false;
  await kv.put(key, String(n + 1), { expirationTtl: 2 * 3600 });
  return true;
}
