export const GRAMS_PER_OUNCE = 31.1034768;

/** Fineness = parts per 1000 pure gold. Labels use the stamp shops use (999, 916…). */
export const PURITIES = [
  { id: "999.9", label: "999.9 · 24K bullion", fineness: 999.9, karat: 24 },
  { id: "999", label: "999 · 24K", fineness: 999, karat: 23.976 },
  { id: "995", label: "995 · bar", fineness: 995, karat: 23.88 },
  { id: "916", label: "916 · 22K", fineness: 916, karat: 21.984 },
  { id: "875", label: "875 · 21K", fineness: 875, karat: 21 },
  { id: "835", label: "835 · 20K", fineness: 835, karat: 20.04 },
  { id: "750", label: "750 · 18K", fineness: 750, karat: 18 },
  { id: "585", label: "585 · 14K", fineness: 585, karat: 14.04 },
  { id: "417", label: "417 · 10K", fineness: 417, karat: 10.008 },
  { id: "375", label: "375 · 9K", fineness: 375, karat: 9 },
] as const;
export type PurityId = (typeof PURITIES)[number]["id"];
/** Old karat labels from earlier versions of the app and of exported vault files. */
export const LEGACY_PURITY: Record<string, PurityId> = { "24K": "999.9", "22K": "916", "21K": "875", "18K": "750", "14K": "585", "10K": "417", "9K": "375" };

/**
 * A known stamp ("916", also typed as a number, with spaces) or a karat label ("22K", any case), otherwise null. Use this wherever
 * a value comes from outside (a file, a form, the scanner): an unknown value is rejected, never turned into 916.
 */
export function parsePurity(v: unknown): PurityId | null {
  const raw = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (PURITIES.some((x) => x.id === raw)) return raw as PurityId;
  return LEGACY_PURITY[raw.toUpperCase()] ?? null;
}
/**
 * Forgiving form for values already inside the app: an unknown code silently becomes 916. Do NOT use it to read outside
 * data (the Vault import and the calculators use `parsePurity` and reject instead).
 */
export const normPurity = (p: string): PurityId => parsePurity(p) ?? "916";
export const purityLabel = (p: string) => PURITIES.find((x) => x.id === normPurity(p))!.label;

export type Country = {
  id: string;
  name: string;
  currency: string;
  rate: number; // local units per 1 USD
  duty: number; // %
  tax: number; // %
  premium?: number; // % typical shop/counter mark-up over raw metal (falls back to DEFAULT_RETAIL_MARGIN_PCT)
};

export type UpahMode = "perGram" | "flat";
/** What the shopper typed at the counter. Money is in `Trade.currency`; 0 means "not given". */
export type BuyForm = {
  shopRate: number;
  upah: number;
  upahMode: UpahMode;
  quotedTotal: number;
  /** Optional: what this same shop pays when you sell back (a rate per gram, or a susut % of its selling rate). */
  buyBackRate: number;
  susutPct: number | null;
};
export type SellForm = {
  buyBackRate: number;
  sellRate: number;
  susutPct: number | null;
  offer: number;
  tradeInRate: number;
  fee: number;
};
export type QuoteForm = { name: string; sellRate: number; upah: number; upahMode: UpahMode; buyBackRate: number };

export type Trade = {
  weight: number;
  purity: PurityId;
  side?: "buy" | "sell" | "compare";
  /** The currency the money fields below were typed in. Converted when the display currency changes. */
  currency: string;
  buy: BuyForm;
  sell: SellForm;
  quotes: QuoteForm[];
  countryId: string; // the country the country views (More page) price this piece in
};

/**
 * One piece in My gold. `paid` and `currency` are what the person actually paid, in the currency they paid it in: they never change
 * when an exchange rate does. `paidUsd` is kept beside them (the figure at entry) for older app versions and as a last-resort
 * fallback; pieces saved before this change have only `paidUsd` until `migrateVaultPaid` fills the other two in.
 */
export type VaultItem = {
  id: string;
  name: string;
  weight: number;
  purity: PurityId;
  paidUsd: number;
  paid?: number;
  currency?: string;
  date: string;
  updatedAt?: string;
};

export type Settings = {
  spotUsdOz: number;
  apiKey: string;
  source: "manual" | "live" | "market"; // market = latest daily close from the published snapshot
  updatedAt: string;
  decimals: number;
  baseCurrency: string; // display currency
  baseRate: number; // manual local-per-USD rate, used only when base currency is not in the watchlist
  mode: "simple" | "pro";
  priceBasis: "raw" | "retail"; // raw spot benchmark vs typical shop counter price (country views only)
  language: "en" | "ms";
  livePromptSeen: boolean; // the one-time "add your own GoldAPI key?" pop-up has been answered or closed
};

export const DEFAULT_SETTINGS: Settings = {
  spotUsdOz: 2650,
  apiKey: "",
  source: "manual",
  updatedAt: "",
  decimals: 2,
  baseCurrency: "MYR",
  baseRate: 1,
  mode: "simple",
  priceBasis: "retail",
  language: "en",
  livePromptSeen: false,
};

/** Indicative exchange rates for the first paint; the real ones come from the daily snapshot (see `effectiveRate`). */
export const DEFAULT_COUNTRIES: Country[] = [
  { id: "my", name: "Malaysia", currency: "MYR", rate: 4.1, duty: 0, tax: 0 },
  { id: "sg", name: "Singapore", currency: "SGD", rate: 1.28, duty: 0, tax: 9 },
  { id: "ae", name: "UAE (Dubai)", currency: "AED", rate: 3.6725, duty: 0, tax: 5 },
  { id: "in", name: "India", currency: "INR", rate: 96, duty: 6, tax: 3 },
];

/**
 * Every exchange rate this app has ever shipped as a default, per currency. A watchlist rate that still equals one of these
 * was never edited by the person, so it follows the market rate from the daily snapshot; any other value is theirs and is kept.
 */
export const SHIPPED_RATES: Record<string, readonly number[]> = {
  MYR: [4.45, 4.1],
  SGD: [1.34, 1.35, 1.28],
  INR: [83.5, 88, 96],
  AED: [3.6725, 3.67],
};

/** The rate to use for a watchlist country: the snapshot's market rate unless the person set their own. */
export function effectiveRate(c: Pick<Country, "currency" | "rate">, marketFx: Record<string, number> | null | undefined): number {
  const market = marketFx?.[c.currency];
  if (market && market > 0 && (SHIPPED_RATES[c.currency] ?? []).includes(c.rate)) return market;
  return c.rate;
}

/** The per-country shop margins this app used to ship (Malaysia 6%, the rest 3%). They had no source; the one 5% assumption replaces them. */
const LEGACY_SHIPPED_PREMIUMS: Record<string, number> = { my: 6, sg: 3, ae: 3, in: 3 };

/** A watchlist country as it should be used: market exchange rate unless the person set their own, and no retired default margin. */
export function effectiveCountry(c: Country, marketFx: Record<string, number> | null | undefined): Country {
  const { premium, ...rest } = c;
  const retired = premium !== undefined && LEGACY_SHIPPED_PREMIUMS[c.id] === premium;
  return { ...rest, rate: effectiveRate(c, marketFx), ...(premium !== undefined && !retired ? { premium } : {}) };
}

export const DEFAULT_TRADE: Trade = {
  weight: 10,
  purity: "916",
  side: "buy",
  currency: "MYR",
  buy: { shopRate: 0, upah: 0, upahMode: "flat", quotedTotal: 0, buyBackRate: 0, susutPct: null },
  sell: { buyBackRate: 0, sellRate: 0, susutPct: null, offer: 0, tradeInRate: 0, fee: 0 },
  quotes: [
    { name: "", sellRate: 0, upah: 0, upahMode: "flat", buyBackRate: 0 },
    { name: "", sellRate: 0, upah: 0, upahMode: "flat", buyBackRate: 0 },
  ],
  countryId: "my",
};

/** True while the user has never set a price themselves: still the shipped default, untouched. */
export const hasDefaultSpot = (s: Settings) =>
  s.source === "manual" && s.updatedAt === "" && s.spotUsdOz === DEFAULT_SETTINGS.spotUsdOz;

/**
 * Should the one-time "want a live price?" pop-up appear? Only for people on the default price (the latest daily
 * close) who have no key of their own, and only once. Never for someone who typed a price or already added a key.
 */
export const shouldPromptForLiveKey = (s: Settings) =>
  !s.livePromptSeen && s.apiKey.trim() === "" && s.source !== "live" && (s.source === "market" || hasDefaultSpot(s));

export const karatOf = (p: string) => PURITIES.find((x) => x.id === normPurity(p))!.karat;
export const fineOf = (p: string) => PURITIES.find((x) => x.id === normPurity(p))!.fineness / 1000;
export type Basis = Settings["priceBasis"];
/** One labelled assumption for the shop's margin over metal (country views only): Malaysian posted 916 rates cluster at +3% to +6%. */
export const DEFAULT_RETAIL_MARGIN_PCT = 5;
export const premiumOf = (c: Country, basis: Basis = "retail") => (basis === "retail" ? (c.premium ?? DEFAULT_RETAIL_MARGIN_PCT) : 0);
export const BASIS_LABEL: Record<Basis, string> = { raw: "Raw spot", retail: "Shop price" };

/** Local units per 1 USD for the display currency. Falls back to the manual rate. */
export function baseRateOf(settings: Settings, countries: Country[]): number {
  if (settings.baseCurrency === "USD") return 1;
  const c = countries.find((x) => x.currency === settings.baseCurrency);
  if (c) return c.rate;
  return settings.baseRate > 0 ? settings.baseRate : 1;
}

/** Local units per 1 USD for any currency the app knows a rate for, otherwise null. */
export function currencyRate(currency: string, settings: Settings, countries: Country[]): number | null {
  if (currency === "USD") return 1;
  const c = countries.find((x) => x.currency === currency);
  if (c && c.rate > 0) return c.rate;
  if (settings.baseCurrency === currency && settings.baseRate > 0) return settings.baseRate;
  return null;
}

/** Whether a rate for this currency is actually known (USD, a watchlist currency, or the manual rate when it is the display currency). */
export function rateKnown(currency: string, settings: Settings, countries: Country[]): boolean {
  if (currency === "USD") return true;
  if (countries.some((c) => c.currency === currency)) return true;
  return settings.baseCurrency === currency && settings.baseRate > 0;
}

// =====================================================================================================================
// The calculation engine (docs/calculations.md is the specification; every number below is checked against its examples).
// Pure functions: the gold price (USD per ounce) and the exchange rate (local units per USD) are arguments, and every amount
// the shopper typed is in the display currency. No component does its own gold arithmetic.
// =====================================================================================================================

/** Published 916 buy-backs sat 1.6% to 3.6% under the metal value on 13-14 Oct 2026; this is the labelled estimate used when no rate is known. */
export const SELL_ESTIMATE_DISCOUNT_PCT = 3;
/** Shops round to whole ringgit, so a quoted total within this of the expected total "adds up" (in the currency the numbers are in). */
export const ADDS_UP_TOLERANCE = 1;
/** Offered as a starting point for susut (a calculator's tier for used gold in good condition); never applied silently. */
export const SUSUT_STARTING_POINT_PCT = 7;

const pos = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const nonNeg = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

/** Display-currency value of 1 gram of metal of this purity at the market price. */
export const metalPerGram = (purity: PurityId, usdPerOz: number, fxPerUsd: number) => fineOf(purity) * (usdPerOz / GRAMS_PER_OUNCE) * fxPerUsd;

/** What the pure gold in a piece is worth at the market price. A reference: never a shop's price and never a "fair price". */
export const rawGoldValue = (weight: number, purity: PurityId, usdPerOz: number, fxPerUsd: number) => weight * metalPerGram(purity, usdPerOz, fxPerUsd);

export type SellBasis = "buyBack" | "susut" | "estimate";
export type SellEstimate = {
  payout: number;
  basis: SellBasis;
  /** The buy-back rate behind the payout when it is known or implied (route 1 and 2). */
  buyBackRate: number | null;
  /** The susut % behind the payout when it is known or implied. */
  susutPct: number | null;
};

/**
 * What a shop should pay for gold, in order of how much the shopper knows:
 *  1. the shop's buy-back rate per gram;  2. its sell rate and a susut % (of the sell rate);  3. an estimate from the metal value.
 * Upah is never part of it: it is not recovered when you sell.
 */
export function estimateSell(a: {
  weight: number;
  rawValue: number;
  buyBackRate?: number | null | undefined;
  sellRate?: number | null | undefined;
  susutPct?: number | null | undefined;
  fee?: number | null | undefined;
}): SellEstimate {
  const fee = nonNeg(a.fee) ? a.fee : 0;
  let payout: number;
  let basis: SellBasis;
  let buyBackRate: number | null = null;
  let susutPct: number | null = null;
  if (pos(a.buyBackRate)) {
    basis = "buyBack";
    buyBackRate = a.buyBackRate;
    payout = a.weight * a.buyBackRate;
    if (pos(a.sellRate)) susutPct = ((a.sellRate - a.buyBackRate) / a.sellRate) * 100;
  } else if (pos(a.sellRate) && nonNeg(a.susutPct) && a.susutPct < 100) {
    basis = "susut";
    susutPct = a.susutPct;
    buyBackRate = a.sellRate * (1 - a.susutPct / 100);
    payout = a.weight * buyBackRate;
  } else {
    basis = "estimate";
    payout = a.rawValue * (1 - SELL_ESTIMATE_DISCOUNT_PCT / 100);
  }
  return { payout: Math.max(0, payout - fee), basis, buyBackRate, susutPct };
}

export type CheckError = "weight" | "price" | "shopRate" | "upah" | "quotes";
export type Quoted = { total: number; difference: number; addsUp: boolean; realRatePerGram: number };

export type BuyInput = {
  weight: number;
  purity: PurityId;
  shopRate: number; // per gram, for this purity
  upah: number;
  upahMode: UpahMode;
  quotedTotal?: number | null | undefined;
  buyBackRate?: number | null | undefined;
  susutPct?: number | null | undefined;
  usdPerOz: number;
  fxPerUsd: number;
};
export type BuyResult =
  | {
      ok: true;
      goldPart: number;
      upahPart: number;
      expectedTotal: number;
      raw: number;
      shopMargin: number;
      shopMarginPct: number;
      paidOverRaw: number;
      upahShare: number;
      quote: Quoted | null;
      sellBack: SellEstimate;
      roundTripLoss: number;
    }
  | { ok: false; error: CheckError };

/** The buy check: does the shop's total add up, what is gold and what is workmanship, and what would you get back. */
export function buyCheck(i: BuyInput): BuyResult {
  if (!pos(i.weight)) return { ok: false, error: "weight" };
  if (!pos(i.usdPerOz) || !pos(i.fxPerUsd)) return { ok: false, error: "price" };
  if (!pos(i.shopRate)) return { ok: false, error: "shopRate" };
  if (!nonNeg(i.upah)) return { ok: false, error: "upah" };
  const goldPart = i.weight * i.shopRate;
  const upahPart = i.upahMode === "perGram" ? i.upah * i.weight : i.upah;
  const expectedTotal = goldPart + upahPart;
  const raw = rawGoldValue(i.weight, i.purity, i.usdPerOz, i.fxPerUsd);
  const shopMargin = goldPart - raw;
  const sellBack = estimateSell({ weight: i.weight, rawValue: raw, buyBackRate: i.buyBackRate, sellRate: i.shopRate, susutPct: i.susutPct });
  const quote: Quoted | null = pos(i.quotedTotal)
    ? {
        total: i.quotedTotal,
        difference: i.quotedTotal - expectedTotal,
        addsUp: Math.abs(i.quotedTotal - expectedTotal) <= ADDS_UP_TOLERANCE,
        realRatePerGram: (i.quotedTotal - upahPart) / i.weight,
      }
    : null;
  return {
    ok: true,
    goldPart,
    upahPart,
    expectedTotal,
    raw,
    shopMargin,
    shopMarginPct: raw > 0 ? (shopMargin / raw) * 100 : 0,
    paidOverRaw: expectedTotal - raw,
    upahShare: expectedTotal > 0 ? upahPart / expectedTotal : 0,
    quote,
    sellBack,
    roundTripLoss: expectedTotal - sellBack.payout,
  };
}

export type SellInput = {
  weight: number;
  purity: PurityId;
  buyBackRate?: number | null | undefined;
  sellRate?: number | null | undefined;
  susutPct?: number | null | undefined;
  offer?: number | null | undefined;
  tradeInRate?: number | null | undefined;
  fee?: number | null | undefined;
  usdPerOz: number;
  fxPerUsd: number;
};
export type SellResult =
  | {
      ok: true;
      raw: number;
      estimate: SellEstimate;
      payout: number;
      offer: { amount: number; difference: number; pct: number | null } | null;
      tradeIn: { credit: number; gain: number } | null;
    }
  | { ok: false; error: CheckError };

/** The sell / trade-in check: what the shop's rate says it should pay, against what it offered. */
export function sellCheck(i: SellInput): SellResult {
  if (!pos(i.weight)) return { ok: false, error: "weight" };
  if (!pos(i.usdPerOz) || !pos(i.fxPerUsd)) return { ok: false, error: "price" };
  const raw = rawGoldValue(i.weight, i.purity, i.usdPerOz, i.fxPerUsd);
  const estimate = estimateSell({ weight: i.weight, rawValue: raw, buyBackRate: i.buyBackRate, sellRate: i.sellRate, susutPct: i.susutPct, fee: i.fee });
  const payout = estimate.payout;
  const offer = pos(i.offer)
    ? { amount: i.offer, difference: i.offer - payout, pct: payout > 0 ? ((i.offer - payout) / payout) * 100 : null }
    : null;
  const tradeIn = pos(i.tradeInRate)
    ? { credit: i.weight * i.tradeInRate, gain: i.weight * i.tradeInRate - payout }
    : null;
  return { ok: true, raw, estimate, payout, offer, tradeIn };
}

/**
 * My gold: what one piece is worth now and roughly what it would fetch. The same raw value and the same sell hierarchy as the
 * checks, so one piece gives the same numbers on every screen.
 */
export function pieceValue(p: { weight: number; purity: PurityId; usdPerOz: number; fxPerUsd: number; buyBackRate?: number | null | undefined; sellRate?: number | null | undefined; susutPct?: number | null | undefined }) {
  const raw = rawGoldValue(p.weight, p.purity, p.usdPerOz, p.fxPerUsd);
  const est = estimateSell({ weight: p.weight, rawValue: raw, buyBackRate: p.buyBackRate, sellRate: p.sellRate, susutPct: p.susutPct });
  return { valueNow: raw, estimatedSell: est.payout, basis: est.basis };
}

export type CompareRow = { index: number; name: string; total: number; payout: number | null; roundTripLoss: number | null };
export type CompareResult =
  | { ok: true; rows: CompareRow[]; buyHere: number[]; sellHere: number[] }
  | { ok: false; error: CheckError };

const TIE = 0.005;

/**
 * Buy here / Sell here for the same weight and purity at several shops. Buy here = lowest total; Sell here = highest payout among
 * the shops that gave a buy-back rate (a payout is never guessed). `buyHere` / `sellHere` hold the row indexes (ties included).
 */
export function compareQuotes(weight: number, quotes: ReadonlyArray<Pick<QuoteForm, "name" | "sellRate" | "upah" | "upahMode" | "buyBackRate">>): CompareResult {
  if (!pos(weight)) return { ok: false, error: "weight" };
  const rows: CompareRow[] = [];
  quotes.forEach((q, index) => {
    if (!pos(q.sellRate) || !nonNeg(q.upah)) return; // blank or unusable rows are left out, not guessed
    const total = weight * q.sellRate + (q.upahMode === "perGram" ? q.upah * weight : q.upah);
    const payout = pos(q.buyBackRate) ? weight * q.buyBackRate : null;
    rows.push({ index, name: q.name.trim(), total, payout, roundTripLoss: payout === null ? null : total - payout });
  });
  if (rows.length === 0) return { ok: false, error: "quotes" };
  const minTotal = Math.min(...rows.map((r) => r.total));
  const withPayout = rows.filter((r): r is CompareRow & { payout: number } => r.payout !== null);
  const maxPayout = withPayout.length ? Math.max(...withPayout.map((r) => r.payout)) : null;
  return {
    ok: true,
    rows,
    buyHere: rows.filter((r) => r.total - minTotal <= TIE).map((r) => r.index),
    sellHere: maxPayout === null ? [] : withPayout.filter((r) => maxPayout - r.payout <= TIE).map((r) => r.index),
  };
}

/**
 * A rough price for a piece at a counter in another country (the More page). Metal, plus the shop's margin, plus import duty on
 * that (only where domestic gold carries it), plus upah, then tax on everything. Never applies duty to upah. Not a quote.
 */
export function countryEstimate(a: { weight: number; purity: PurityId; country: Country; usdPerOz: number; basis?: Basis; upahUsd?: number }) {
  const spotG = a.usdPerOz / GRAMS_PER_OUNCE;
  const pureGrams = a.weight * fineOf(a.purity);
  const metalUsd = pureGrams * spotG;
  const marginUsd = metalUsd * (premiumOf(a.country, a.basis ?? "retail") / 100);
  const withMargin = metalUsd + marginUsd;
  const afterDuty = withMargin * (1 + a.country.duty / 100);
  const upahUsd = nonNeg(a.upahUsd) ? a.upahUsd : 0;
  const preTax = afterDuty + upahUsd;
  const totalUsd = preTax * (1 + a.country.tax / 100);
  return {
    pureGrams,
    metalUsd,
    marginUsd,
    dutyUsd: afterDuty - withMargin,
    upahUsd,
    taxUsd: totalUsd - preTax,
    totalUsd,
    totalLocal: totalUsd * a.country.rate,
    perGramUsd: a.weight > 0 ? totalUsd / a.weight : 0,
    /** How far the total sits above the metal value, in %. */
    overMetalPct: metalUsd > 0 ? ((totalUsd - metalUsd) / metalUsd) * 100 : 0,
  };
}

/** The upah the shopper typed in the Buy check, for the whole piece, in USD (what the country views add on top of the metal). */
export function tradeUpahUsd(trade: Pick<Trade, "buy" | "weight">, fxPerUsd: number): number {
  if (!(fxPerUsd > 0)) return 0;
  const whole = trade.buy.upahMode === "perGram" ? trade.buy.upah * trade.weight : trade.buy.upah;
  return Number.isFinite(whole) && whole > 0 ? whole / fxPerUsd : 0;
}

/** Landed cost of 1g of gold of the given fineness in a country (metal, margin, duty, tax; no upah). */
export function landedPerGram(country: Country, spotUsdOz: number, basis: Basis = "raw", fineness = 1) {
  return (
    (spotUsdOz / GRAMS_PER_OUNCE) * fineness * (1 + premiumOf(country, basis) / 100) *
    (1 + country.duty / 100) * (1 + country.tax / 100)
  );
}

/**
 * What a piece cost, in the display currency. In the currency it was paid in, the amount is exactly what was typed (`exact`);
 * in another currency it is converted at today's rate and is not exact. A piece with no `paid` and `currency` (saved by an
 * older version) falls back to its USD figure.
 */
export function paidInDisplay(
  item: Pick<VaultItem, "paid" | "currency" | "paidUsd">,
  display: string,
  displayFx: number,
  rateOf: (currency: string) => number | null,
): { amount: number; exact: boolean } {
  if (typeof item.paid === "number" && typeof item.currency === "string") {
    if (item.currency === display) return { amount: item.paid, exact: true };
    const from = rateOf(item.currency);
    if (from && from > 0) return { amount: (item.paid / from) * displayFx, exact: false };
  }
  return { amount: item.paidUsd * displayFx, exact: false };
}

/**
 * One-time move for pieces saved before the price paid was kept in its own currency: the figure the person typed is recovered as
 * paidUsd x the rate they saved for the display currency (the rate that turned their typing into USD), and then it is fixed.
 * Pieces migrated are re-stamped so the other devices adopt the result. Returns the same array when nothing needed it.
 */
export function migrateVaultPaid(
  vault: VaultItem[],
  o: { currency: string; ratePerUsd: number; now: Date },
): { vault: VaultItem[]; changed: number } {
  if (!(o.ratePerUsd > 0) || !/^[A-Z]{3}$/.test(o.currency)) return { vault, changed: 0 };
  let changed = 0;
  const at = o.now.toISOString();
  const next = vault.map((v) => {
    if (typeof v.paid === "number" && typeof v.currency === "string") return v;
    changed++;
    return { ...v, paid: Math.round(v.paidUsd * o.ratePerUsd * 100) / 100, currency: o.currency, updatedAt: at };
  });
  return changed ? { vault: next, changed } : { vault, changed: 0 };
}

/** Amounts typed in one currency, restated in another (used when the display currency changes). */
export function convertTradeMoney(trade: Trade, from: number, to: number, currency: string): Trade {
  if (!(from > 0) || !(to > 0)) return { ...trade, currency };
  const k = to / from;
  const r = (n: number) => (n ? Math.round(n * k * 100) / 100 : 0);
  return {
    ...trade,
    currency,
    buy: { ...trade.buy, shopRate: r(trade.buy.shopRate), upah: r(trade.buy.upah), quotedTotal: r(trade.buy.quotedTotal), buyBackRate: r(trade.buy.buyBackRate) },
    sell: {
      ...trade.sell,
      buyBackRate: r(trade.sell.buyBackRate),
      sellRate: r(trade.sell.sellRate),
      offer: r(trade.sell.offer),
      tradeInRate: r(trade.sell.tradeInRate),
      fee: r(trade.sell.fee),
    },
    quotes: trade.quotes.map((q) => ({ ...q, sellRate: r(q.sellRate), upah: r(q.upah), buyBackRate: r(q.buyBackRate) })),
  };
}

/** Drop the money fields (when the old currency's rate is not known, so it cannot be converted honestly). */
export function clearTradeMoney(trade: Trade, currency: string): Trade {
  return { ...DEFAULT_TRADE, weight: trade.weight, purity: trade.purity, countryId: trade.countryId, currency, ...(trade.side ? { side: trade.side } : {}) };
}

export function fmt(n: number, currency = "USD", decimals = 2) {
  if (!isFinite(n)) return "—";
  try {
    // ringgit prints as "RM 5,053.51" (the en-US locale would write "MYR 5,053.51"); everything else keeps the en-US form
    return new Intl.NumberFormat(currency === "MYR" ? "en-MY" : "en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(n);
  } catch {
    return `${n.toFixed(decimals)} ${currency}`;
  }
}

export async function fetchLiveSpot(apiKey: string): Promise<number> {
  const key = apiKey.trim().replace(/^["']|["']$/g, "");
  let res: Response;
  try {
    res = await fetch("https://www.goldapi.io/api/XAU/USD", { headers: { "x-access-token": key } });
  } catch {
    throw new Error("can't reach goldapi.io — check your internet connection");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String(data?.error || "");
    if (res.status === 403 || /invalid api key/i.test(msg)) throw new Error("GoldAPI says this key is invalid — copy it again from your goldapi.io dashboard");
    if (res.status === 429 || /limit|quota/i.test(msg)) throw new Error("free monthly request limit reached on GoldAPI");
    throw new Error(msg || `price service replied ${res.status}`);
  }
  const price = Number(data?.price);
  if (!price || !isFinite(price)) throw new Error(data?.error || "no price in the response");
  return price;
}
