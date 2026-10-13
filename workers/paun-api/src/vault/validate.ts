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
/** Preferences that follow the account. A whitelist: nothing else (no price, no key, no calculator input) can be stored. */
export type PrefsValue = {
  language?: "en" | "ms";
  baseCurrency?: string;
  baseRate?: number;
  decimals?: number;
  priceBasis?: "raw" | "retail";
  mode?: "simple" | "pro";
  theme?: "dark" | "light";
};
export type WatchCountry = { id: string; name: string; currency: string; rate: number; duty: number; tax: number; premium?: number };
export type WatchlistValue = { countries: WatchCountry[]; excluded: string[] };
/** A whole object and the moment it was last changed; the newest wins. */
export type Stamped<T> = { value: T; updatedAt: string };
export const MAX_COUNTRIES = 60;

export type SyncRequest = {
  since: number;
  items: SyncItem[];
  removed: Removal[];
  prefs?: Stamped<PrefsValue>;
  watchlist?: Stamped<WatchlistValue>;
};

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

/** Like `isoOf` but allowing the epoch: a device that has never synced stamps its settings with it, so an account's real settings always win. */
function stampOf(v: unknown, now: Date): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const ms = Date.parse(v);
  if (!Number.isFinite(ms) || ms < 0 || ms > now.getTime() + 24 * 3600_000) return null;
  return new Date(ms).toISOString();
}
const num = (v: unknown, min: number, max: number, minExclusive = false): v is number =>
  typeof v === "number" && Number.isFinite(v) && (minExclusive ? v > min : v >= min) && v <= max;

/** The preferences, or null if any KNOWN field has a wrong value. Unknown fields are dropped. */
export function validatePrefs(raw: unknown): PrefsValue | null {
  if (!isObject(raw)) return null;
  const out: PrefsValue = {};
  if (raw["language"] !== undefined) {
    if (raw["language"] !== "en" && raw["language"] !== "ms") return null;
    out.language = raw["language"];
  }
  if (raw["baseCurrency"] !== undefined) {
    if (typeof raw["baseCurrency"] !== "string" || !/^[A-Z]{3}$/.test(raw["baseCurrency"])) return null;
    out.baseCurrency = raw["baseCurrency"];
  }
  if (raw["baseRate"] !== undefined) {
    if (!num(raw["baseRate"], 0, 1e9, true)) return null;
    out.baseRate = raw["baseRate"];
  }
  if (raw["decimals"] !== undefined) {
    if (!num(raw["decimals"], 0, 4) || !Number.isInteger(raw["decimals"])) return null;
    out.decimals = raw["decimals"];
  }
  if (raw["priceBasis"] !== undefined) {
    if (raw["priceBasis"] !== "raw" && raw["priceBasis"] !== "retail") return null;
    out.priceBasis = raw["priceBasis"];
  }
  if (raw["mode"] !== undefined) {
    if (raw["mode"] !== "simple" && raw["mode"] !== "pro") return null;
    out.mode = raw["mode"];
  }
  if (raw["theme"] !== undefined) {
    if (raw["theme"] !== "dark" && raw["theme"] !== "light") return null;
    out.theme = raw["theme"];
  }
  return out;
}

/** The watchlist, or null if anything in it is invalid. */
export function validateWatchlist(raw: unknown): WatchlistValue | null {
  if (!isObject(raw) || !Array.isArray(raw["countries"]) || raw["countries"].length > MAX_COUNTRIES) return null;
  const countries: WatchCountry[] = [];
  const ids = new Set<string>();
  for (const c of raw["countries"]) {
    if (!isObject(c)) return null;
    const { id, name, currency, rate, duty, tax, premium } = c;
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(id) || ids.has(id)) return null;
    if (typeof name !== "string" || name.length < 1 || name.length > 60) return null;
    if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) return null;
    if (!num(rate, 0, 1e7, true) || !num(duty, 0, 100) || !num(tax, 0, 100)) return null;
    if (premium !== undefined && !num(premium, 0, 1000)) return null;
    ids.add(id);
    countries.push(premium === undefined ? { id, name, currency, rate, duty, tax } : { id, name, currency, rate, duty, tax, premium });
  }
  const rawExcluded = raw["excluded"] === undefined ? [] : raw["excluded"];
  if (!Array.isArray(rawExcluded) || rawExcluded.length > MAX_COUNTRIES) return null;
  const excluded: string[] = [];
  for (const e of rawExcluded) {
    if (typeof e !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(e)) return null;
    excluded.push(e);
  }
  return { countries, excluded };
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
  const value: SyncRequest = { since, items, removed };
  if (raw["prefs"] !== undefined) {
    const p = isObject(raw["prefs"]) ? validatePrefs(raw["prefs"]["value"]) : null;
    const at = isObject(raw["prefs"]) ? stampOf(raw["prefs"]["updatedAt"], now) : null;
    if (!p || !at) return { ok: false, field: "prefs" };
    value.prefs = { value: p, updatedAt: at };
  }
  if (raw["watchlist"] !== undefined) {
    const w = isObject(raw["watchlist"]) ? validateWatchlist(raw["watchlist"]["value"]) : null;
    const at = isObject(raw["watchlist"]) ? stampOf(raw["watchlist"]["updatedAt"], now) : null;
    if (!w || !at) return { ok: false, field: "watchlist" };
    value.watchlist = { value: w, updatedAt: at };
  }
  return { ok: true, value };
}
