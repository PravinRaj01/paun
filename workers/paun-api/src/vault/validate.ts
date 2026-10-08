import { PURITY_IDS, type PurityId } from "../scan/purity";

/**
 * What a device may send to POST /sync, and the checks every piece must pass before it touches the database. The device validates
 * too, but the server never trusts it: a bad row is refused, not repaired.
 */
export const MAX_ITEMS = 2000; // pieces per account
export const MAX_BODY_CHARS = 512_000; // per request
export const SYNC_PER_HOUR = 120; // per account

export type SyncItem = { id: string; name: string; weight: number; purity: PurityId; paidUsd: number; date: string; updatedAt: string };
export type Removal = { id: string; deletedAt: string };
export type SyncRequest = { since: number; items: SyncItem[]; removed: Removal[] };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** An ISO timestamp with a zone ("2026-10-09T01:02:03.000Z"), not absurdly old or far in the future. Returns the normalised ISO string. */
function isoOf(v: unknown, now: Date): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const ms = Date.parse(v);
  if (!Number.isFinite(ms) || ms < Date.UTC(2020, 0, 1) || ms > now.getTime() + 24 * 3600_000) return null;
  return new Date(ms).toISOString();
}
function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s;
}

function item(raw: unknown, now: Date): SyncItem | null {
  if (!isObject(raw)) return null;
  const { id, name, weight, purity, paidUsd, date, updatedAt } = raw;
  const at = isoOf(updatedAt, now);
  if (typeof id !== "string" || !ID.test(id) || typeof name !== "string" || name.length > 80) return null;
  if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0 || weight > 10_000) return null;
  if (typeof purity !== "string" || !(PURITY_IDS as readonly string[]).includes(purity)) return null;
  if (typeof paidUsd !== "number" || !Number.isFinite(paidUsd) || paidUsd < 0 || paidUsd > 1_000_000_000) return null;
  if (typeof date !== "string" || !isRealDate(date) || !at) return null;
  return { id, name, weight, purity: purity as PurityId, paidUsd, date, updatedAt: at };
}
function removal(raw: unknown, now: Date): Removal | null {
  if (!isObject(raw)) return null;
  const at = isoOf(raw["deletedAt"], now);
  return typeof raw["id"] === "string" && ID.test(raw["id"]) && at ? { id: raw["id"], deletedAt: at } : null;
}

export type Validated = { ok: true; value: SyncRequest } | { ok: false; field: string };

export function validateSyncBody(raw: unknown, now: Date): Validated {
  if (!isObject(raw)) return { ok: false, field: "body" };
  const since = raw["since"] === undefined ? 0 : raw["since"];
  if (typeof since !== "number" || !Number.isInteger(since) || since < 0) return { ok: false, field: "since" };
  const rawItems = raw["items"] === undefined ? [] : raw["items"];
  const rawRemoved = raw["removed"] === undefined ? [] : raw["removed"];
  if (!Array.isArray(rawItems) || rawItems.length > MAX_ITEMS) return { ok: false, field: "items" };
  if (!Array.isArray(rawRemoved) || rawRemoved.length > MAX_ITEMS) return { ok: false, field: "removed" };
  const items: SyncItem[] = [];
  for (const r of rawItems) {
    const it = item(r, now);
    if (!it) return { ok: false, field: "items" };
    items.push(it);
  }
  const removed: Removal[] = [];
  for (const r of rawRemoved) {
    const rm = removal(r, now);
    if (!rm) return { ok: false, field: "removed" };
    removed.push(rm);
  }
  // a piece cannot be both added and removed in the same request, and ids must not repeat
  const seen = new Set<string>();
  for (const id of [...items.map((i) => i.id), ...removed.map((r) => r.id)]) {
    if (seen.has(id)) return { ok: false, field: "items" };
    seen.add(id);
  }
  return { ok: true, value: { since, items, removed } };
}
