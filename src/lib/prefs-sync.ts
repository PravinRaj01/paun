import type { Country, Settings } from "./gold";

/**
 * Preferences and watchlist that follow the account (PLAN.md 4b.5). A whitelist, on purpose: only the fields named here can ever
 * leave the device. Never the spot price or its source, never a key, never the calculator's inputs, never "have I seen the live-price
 * pop-up". Each half travels whole with the moment it last changed, and the newest wins.
 */
export type PrefsValue = {
  language?: "en" | "ms";
  baseCurrency?: string;
  baseRate?: number;
  decimals?: number;
  priceBasis?: "raw" | "retail";
  mode?: "simple" | "pro";
  theme?: "dark" | "light";
};
export type WatchlistValue = { countries: Country[]; excluded: string[] };
export type Stamped<T> = { value: T; updatedAt: string };

/** A device that has never synced settings stamps them with this, so whatever the account already holds always wins. */
export const EPOCH = "1970-01-01T00:00:00.000Z";

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const CURRENCY = /^[A-Z]{3}$/;
const num = (v: unknown, min: number, max: number, minExclusive = false): v is number =>
  typeof v === "number" && Number.isFinite(v) && (minExclusive ? v > min : v >= min) && v <= max;

/** JSON with every object's keys sorted: two equal values give the same text, whatever order they were built or stored in. */
export function canonicalJson(v: unknown): string {
  const sort = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(sort) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, y]) => [k, sort(y)])) : x;
  return JSON.stringify(sort(v));
}

export function pickPrefs(settings: Settings, theme: "dark" | "light"): PrefsValue {
  return {
    language: settings.language,
    baseCurrency: settings.baseCurrency,
    baseRate: settings.baseRate,
    decimals: settings.decimals,
    priceBasis: settings.priceBasis,
    mode: settings.mode,
    theme,
  };
}

/** What can safely be sent: invalid fields are left out (a corrupt value must not stop the rest of the sync). */
export function parsePrefs(raw: unknown): PrefsValue {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: PrefsValue = {};
  if (r["language"] === "en" || r["language"] === "ms") out.language = r["language"];
  if (typeof r["baseCurrency"] === "string" && CURRENCY.test(r["baseCurrency"])) out.baseCurrency = r["baseCurrency"];
  if (num(r["baseRate"], 0, 1e9, true)) out.baseRate = r["baseRate"];
  if (num(r["decimals"], 0, 4) && Number.isInteger(r["decimals"])) out.decimals = r["decimals"];
  if (r["priceBasis"] === "raw" || r["priceBasis"] === "retail") out.priceBasis = r["priceBasis"];
  if (r["mode"] === "simple" || r["mode"] === "pro") out.mode = r["mode"];
  if (r["theme"] === "dark" || r["theme"] === "light") out.theme = r["theme"];
  return out;
}

/** Valid countries only (a country with a zero rate, say, is left out of what is sent), at most 60. */
export function sanitizeWatchlist(countries: Country[], excluded: string[]): WatchlistValue {
  const ids = new Set<string>();
  const ok: Country[] = [];
  for (const c of countries) {
    if (!c || typeof c.id !== "string" || !ID.test(c.id) || ids.has(c.id)) continue;
    if (typeof c.name !== "string" || c.name.length < 1) continue;
    if (typeof c.currency !== "string" || !CURRENCY.test(c.currency)) continue;
    if (!num(c.rate, 0, 1e7, true) || !num(c.duty, 0, 100) || !num(c.tax, 0, 100)) continue;
    if (c.premium !== undefined && !num(c.premium, 0, 1000)) continue;
    ids.add(c.id);
    ok.push(c.premium === undefined ? { id: c.id, name: c.name.slice(0, 60), currency: c.currency, rate: c.rate, duty: c.duty, tax: c.tax } : { id: c.id, name: c.name.slice(0, 60), currency: c.currency, rate: c.rate, duty: c.duty, tax: c.tax, premium: c.premium });
  }
  return { countries: ok.slice(0, 60), excluded: excluded.filter((e) => typeof e === "string" && ID.test(e)).slice(0, 60) };
}

/** Put received preferences onto the device's settings. Only the whitelisted fields can change, whatever else the message held. */
export function applyPrefs(settings: Settings, received: PrefsValue): Settings {
  const v = parsePrefs(received);
  return {
    ...settings,
    ...(v.language ? { language: v.language } : {}),
    ...(v.baseCurrency ? { baseCurrency: v.baseCurrency } : {}),
    ...(v.baseRate !== undefined ? { baseRate: v.baseRate } : {}),
    ...(v.decimals !== undefined ? { decimals: v.decimals } : {}),
    ...(v.priceBasis ? { priceBasis: v.priceBasis } : {}),
    ...(v.mode ? { mode: v.mode } : {}),
  };
}

/** Local preferences with the received ones on top: the state the device is in after adopting what the account holds. */
export const mergePrefs = (local: PrefsValue, received: PrefsValue): PrefsValue => ({ ...local, ...parsePrefs(received) });
