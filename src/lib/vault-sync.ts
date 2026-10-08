import { API_BASE } from "./api";
import { PURITIES, type VaultItem } from "./gold";

/**
 * Vault sync, device side (PLAN.md 4b.4). The Vault stays plain LocalStorage written by five different places; this module never
 * changes them. It looks at what is in the Vault, works out what the server has not seen, sends it, and merges what comes back.
 *
 * Rules (the server enforces the same ones):
 *  - per piece id, the NEWEST `updatedAt` wins;
 *  - a removal is a tombstone that an older copy cannot undo, so a device that was offline cannot bring a removed piece back;
 *  - the first sync of a device is a UNION: pieces on the device and in the account are all kept, never duplicated.
 */
export const MAX_ITEMS = 2000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export type Removal = { id: string; deletedAt: string };
export type SyncItem = { id: string; name: string; weight: number; purity: string; paidUsd: number; date: string; updatedAt: string };
export type SyncResponse = { ok: true; version: number; items: SyncItem[]; removed: Removal[] };

/** Pieces and removals the device keeps between syncs. Saved in LocalStorage; contains no keys and no personal data beyond the pieces. */
export type SyncState = {
  userId: string | null; // the account this state belongs to; a different account starts again from scratch
  version: number; // everything on the server up to here has been received
  lastSyncAt: string | null;
  lastPushedAt: string | null; // pieces changed after this moment still need sending
  tombstones: Removal[]; // pieces removed on this device that the server has not been told about
};
export const EMPTY_STATE: SyncState = { userId: null, version: 0, lastSyncAt: null, lastPushedAt: null, tombstones: [] };

// ---------- the saved state ----------
const KEY = "gold-assistant:sync";
export function loadSyncState(): SyncState {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<SyncState> | null;
    if (!v || typeof v !== "object") return { ...EMPTY_STATE };
    const tombstones = Array.isArray(v.tombstones)
      ? v.tombstones.filter((t): t is Removal => !!t && typeof t.id === "string" && typeof t.deletedAt === "string").slice(0, MAX_ITEMS)
      : [];
    return {
      userId: typeof v.userId === "string" ? v.userId : null,
      version: typeof v.version === "number" && Number.isInteger(v.version) && v.version >= 0 ? v.version : 0,
      lastSyncAt: typeof v.lastSyncAt === "string" ? v.lastSyncAt : null,
      lastPushedAt: typeof v.lastPushedAt === "string" ? v.lastPushedAt : null,
      tombstones,
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}
export function saveSyncState(state: SyncState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage blocked: sync still works in this tab, and starts over next time */
  }
}
export function clearSyncState(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

// ---------- what to send ----------
const isRealDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** The piece in the shape the server accepts, or null when it would be refused (a corrupt entry must not block everyone else's sync). */
export function toSyncItem(it: VaultItem, fallbackUpdatedAt: string): SyncItem | null {
  if (!ID.test(it.id) || typeof it.name !== "string") return null;
  if (!(typeof it.weight === "number" && Number.isFinite(it.weight) && it.weight > 0 && it.weight <= 10_000)) return null;
  if (!PURITIES.some((p) => p.id === it.purity)) return null;
  if (!(typeof it.paidUsd === "number" && Number.isFinite(it.paidUsd) && it.paidUsd >= 0 && it.paidUsd <= 1_000_000_000)) return null;
  if (typeof it.date !== "string" || !isRealDate(it.date)) return null;
  const stamp = typeof it.updatedAt === "string" && Number.isFinite(Date.parse(it.updatedAt)) ? new Date(it.updatedAt).toISOString() : fallbackUpdatedAt;
  return { id: it.id, name: it.name.slice(0, 80), weight: it.weight, purity: it.purity, paidUsd: it.paidUsd, date: it.date, updatedAt: stamp };
}

/** Give every piece that has no `updatedAt` one (now), so it counts as changed and gets sent. Returns the same array if nothing changed. */
export function stampMissing(vault: VaultItem[], now: Date): VaultItem[] {
  if (vault.every((v) => typeof v.updatedAt === "string")) return vault;
  const at = now.toISOString();
  return vault.map((v) => (typeof v.updatedAt === "string" ? v : { ...v, updatedAt: at }));
}

export type Push = { items: SyncItem[]; removed: Removal[]; skipped: number };

/** What this device has that the server may not: pieces changed since the last push (all of them, on a first sync), plus pending removals. */
export function planPush(vault: VaultItem[], state: SyncState, userId: string, now: Date): Push {
  const sameAccount = state.userId === userId;
  const since = sameAccount && state.lastPushedAt ? Date.parse(state.lastPushedAt) : -Infinity;
  const at = now.toISOString();
  const items: SyncItem[] = [];
  let skipped = 0;
  for (const v of vault) {
    const stamp = typeof v.updatedAt === "string" ? Date.parse(v.updatedAt) : Date.now();
    if (!(stamp > since)) continue;
    const s = toSyncItem(v, at);
    if (s) items.push(s);
    else skipped++;
  }
  // never send a removal for a piece that is back in the vault (re-added after being removed)
  const live = new Set(vault.map((v) => v.id));
  const removed = state.tombstones.filter((t) => !live.has(t.id));
  return { items: items.slice(0, MAX_ITEMS), removed: removed.slice(0, MAX_ITEMS), skipped };
}

// ---------- what comes back ----------
export type Merge = { vault: VaultItem[]; added: number; updated: number; removed: string[] };

/**
 * Fold the server's changes into the device's Vault. A removal wins over a local copy that is not newer than it; a server piece
 * replaces a local one only when it is newer; pieces only the device has are kept (they are sent on the next push).
 */
export function applyPull(vault: VaultItem[], res: Pick<SyncResponse, "items" | "removed">): Merge {
  const byId = new Map(vault.map((v) => [v.id, v]));
  const removed: string[] = [];
  for (const r of res.removed) {
    const have = byId.get(r.id);
    if (have && !(typeof have.updatedAt === "string" && Date.parse(have.updatedAt) > Date.parse(r.deletedAt))) {
      byId.delete(r.id);
      removed.push(r.id);
    }
  }
  let added = 0;
  let updated = 0;
  for (const it of res.items) {
    if (!PURITIES.some((p) => p.id === it.purity)) continue; // an unknown stamp from a newer app version: leave it out rather than guess
    const have = byId.get(it.id);
    if (!have) {
      byId.set(it.id, { ...it, purity: it.purity as VaultItem["purity"] });
      added++;
    } else if (!(typeof have.updatedAt === "string" && Date.parse(have.updatedAt) >= Date.parse(it.updatedAt))) {
      byId.set(it.id, { ...it, purity: it.purity as VaultItem["purity"] });
      updated++;
    }
  }
  // keep the device's own order, and put newly arrived pieces at the end
  const order = new Map(vault.map((v, i) => [v.id, i]));
  const next = [...byId.values()].sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  return { vault: next, added, updated, removed };
}

// ---------- one sync ----------
export type SyncError = "offline" | "signed_out" | "rate_limited" | "too_many" | "invalid" | "unavailable";
export type SyncOutcome =
  | { ok: true; state: SyncState; merge: (current: VaultItem[]) => Merge; skipped: number; sent: number }
  | { ok: false; error: SyncError };

const errorFor = (status: number): SyncError =>
  status === 401 ? "signed_out" : status === 429 ? "rate_limited" : status === 413 ? "too_many" : status === 400 ? "invalid" : "unavailable";

/**
 * Send what changed, receive what changed. Does not touch the Vault itself: it returns `merge`, to be applied to the Vault as it is
 * AT THAT MOMENT (the person may have edited it while the request was in flight), and the new state to save.
 * The cursor is rewound by a small overlap, so a change that committed on the server just after another device read the list
 * is picked up next time; receiving a piece twice is harmless.
 */
export const CURSOR_OVERLAP = 200;
export async function runSync(o: {
  token: string;
  userId: string;
  vault: VaultItem[];
  state: SyncState;
  now?: Date;
  fetchImpl?: typeof fetch;
  base?: string;
}): Promise<SyncOutcome> {
  const now = o.now ?? new Date();
  const fetchImpl = o.fetchImpl ?? fetch;
  const base = o.base ?? API_BASE;
  const state = o.state.userId === o.userId ? o.state : { ...EMPTY_STATE, userId: o.userId }; // a different account starts afresh
  const push = planPush(o.vault, state, o.userId, now);
  const since = Math.max(0, state.version - CURSOR_OVERLAP);

  let res: Response;
  try {
    res = await fetchImpl(`${base}/sync`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${o.token}` },
      body: JSON.stringify({ since, items: push.items, removed: push.removed }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { ok: false, error: "offline" };
  }
  if (!res.ok) return { ok: false, error: errorFor(res.status) };
  const body = (await res.json().catch(() => null)) as Partial<SyncResponse> | null;
  if (!body || typeof body.version !== "number" || !Array.isArray(body.items) || !Array.isArray(body.removed)) return { ok: false, error: "unavailable" };

  const sentTombstones = new Set(push.removed.map((r) => `${r.id}|${r.deletedAt}`));
  const next: SyncState = {
    userId: o.userId,
    version: Math.max(state.version, body.version),
    lastSyncAt: now.toISOString(),
    lastPushedAt: now.toISOString(), // anything changed after the START of this sync is sent next time
    tombstones: state.tombstones.filter((t) => !sentTombstones.has(`${t.id}|${t.deletedAt}`)),
  };
  const pulled = { items: body.items as SyncItem[], removed: body.removed as Removal[] };
  return { ok: true, state: next, merge: (current) => applyPull(current, pulled), skipped: push.skipped, sent: push.items.length + push.removed.length };
}

/** Pieces that disappeared from the Vault since the last look, as tombstones (skipping ones we removed ourselves because the server said so). */
export function newTombstones(previousIds: Set<string>, current: VaultItem[], serverRemoved: Set<string>, now: Date): Removal[] {
  const live = new Set(current.map((v) => v.id));
  const at = now.toISOString();
  return [...previousIds].filter((id) => !live.has(id) && !serverRemoved.has(id) && ID.test(id)).map((id) => ({ id, deletedAt: at }));
}
