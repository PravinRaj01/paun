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
] as const;
export type PurityId = (typeof PURITIES)[number]["id"];
/** Old karat labels from earlier versions of the app and of exported vault files. */
export const LEGACY_PURITY: Record<string, PurityId> = { "24K": "999.9", "22K": "916", "21K": "875", "18K": "750", "14K": "585", "10K": "417" };
export const normPurity = (p: string): PurityId =>
  (PURITIES.some((x) => x.id === p) ? p : LEGACY_PURITY[p] ?? "916") as PurityId;
export const purityLabel = (p: string) => PURITIES.find((x) => x.id === normPurity(p))!.label;

export type Country = {
  id: string;
  name: string;
  currency: string;
  rate: number; // local units per 1 USD
  duty: number; // %
  tax: number; // %
  premium?: number; // % typical shop/counter mark-up over raw metal
};

export type Trade = {
  weight: number;
  purity: PurityId;
  feeMode: "flat" | "perGram";
  fee: number; // USD
  melting: number; // USD
  askingPrice: number; // USD, 0 = not set
  countryId: string;
  side?: "buy" | "sell";
  deduction?: number; // % susut on sell / trade-in
};

export type VaultItem = { id: string; name: string; weight: number; purity: PurityId; paidUsd: number; date: string };

/** Fair cash for selling gold back: pure metal at spot, minus susut %, minus melting/assay. */
export function sellQuote(trade: Trade, spotUsdOz: number) {
  const pureGrams = trade.weight * fineOf(trade.purity);
  const metal = pureGrams * (spotUsdOz / GRAMS_PER_OUNCE);
  const deductionUsd = metal * ((trade.deduction ?? 5) / 100);
  const payout = Math.max(0, metal - deductionUsd - trade.melting);
  return { pureGrams, metal, deductionUsd, melting: trade.melting, payout };
}

export type Settings = {
  spotUsdOz: number;
  apiKey: string;
  source: "manual" | "live" | "market"; // market = latest daily close from the published snapshot
  updatedAt: string;
  decimals: number;
  baseCurrency: string; // display currency
  baseRate: number; // manual local-per-USD rate, used only when base currency is not in the watchlist
  mode: "simple" | "pro";
  priceBasis: "raw" | "retail"; // raw spot benchmark vs typical shop counter price
  language: "en" | "ms";
  livePromptSeen: boolean; // the one-time "add your own GoldAPI key?" pop-up has been answered or closed
};

export const DEFAULT_SETTINGS: Settings = {
  spotUsdOz: 2650,
  apiKey: "",
  source: "manual",
  updatedAt: "",
  decimals: 2,
  baseCurrency: "USD",
  baseRate: 1,
  mode: "simple",
  priceBasis: "retail",
  language: "en",
  livePromptSeen: false,
};

export const DEFAULT_COUNTRIES: Country[] = [
  { id: "my", name: "Malaysia", currency: "MYR", rate: 4.45, duty: 0, tax: 0, premium: 6 },
  { id: "sg", name: "Singapore", currency: "SGD", rate: 1.34, duty: 0, tax: 0, premium: 3 },
  { id: "ae", name: "UAE (Dubai)", currency: "AED", rate: 3.6725, duty: 0, tax: 5, premium: 3 },
  { id: "in", name: "India", currency: "INR", rate: 83.5, duty: 6, tax: 3, premium: 3 },
];

export const DEFAULT_TRADE: Trade = {
  weight: 10,
  purity: "916",
  feeMode: "perGram",
  fee: 4,
  melting: 0,
  askingPrice: 0,
  countryId: "my",
  side: "buy",
  deduction: 5,
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
export const premiumOf = (c: Country, basis: Basis = "retail") => (basis === "retail" ? (c.premium ?? 5) : 0);
export const BASIS_LABEL: Record<Basis, string> = { raw: "Raw spot", retail: "Shop price" };

/** Local units per 1 USD for the display currency. Falls back to the manual rate. */
export function baseRateOf(settings: Settings, countries: Country[]): number {
  if (settings.baseCurrency === "USD") return 1;
  const c = countries.find((x) => x.currency === settings.baseCurrency);
  if (c) return c.rate;
  return settings.baseRate > 0 ? settings.baseRate : 1;
}

export type VerdictTone = "good" | "fair" | "pricey" | "expensive";
export type Verdict = { label: string; tone: VerdictTone; pct: number };

/** Compares the seller's asking price against the computed fair cost (all-in). */
export function verdictOf(askingPrice: number, totalUsd: number): Verdict | null {
  if (!askingPrice || askingPrice <= 0 || totalUsd <= 0) return null;
  const pct = ((askingPrice - totalUsd) / totalUsd) * 100;
  if (pct <= 0) return { label: "Good deal", tone: "good", pct };
  if (pct <= 5) return { label: "Fair price", tone: "fair", pct };
  if (pct <= 15) return { label: "Pricey", tone: "pricey", pct };
  return { label: "Expensive", tone: "expensive", pct };
}

export function analyze(trade: Trade, country: Country, spotUsdOz: number, basis: Basis = "raw") {
  const spotG = spotUsdOz / GRAMS_PER_OUNCE;
  const pureGrams = trade.weight * fineOf(trade.purity);
  const netGold = pureGrams * spotG;
  const makingFee = trade.feeMode === "flat" ? trade.fee : trade.fee * trade.weight;
  const shopMarkup = netGold * (premiumOf(country, basis) / 100);
  const preTax = netGold + shopMarkup + makingFee; // melting only applies when selling
  const afterDuty = preTax * (1 + country.duty / 100);
  const totalUsd = afterDuty * (1 + country.tax / 100);
  const premiumPct = netGold > 0 ? ((totalUsd - netGold) / netGold) * 100 : 0;
  const breakEvenPerPureG = pureGrams > 0 ? totalUsd / pureGrams : 0;
  const breakEvenPerG = trade.weight > 0 ? totalUsd / trade.weight : 0;
  const askingPremium =
    trade.askingPrice > 0 && netGold > 0 ? ((trade.askingPrice - netGold) / netGold) * 100 : null;
  return {
    spotG,
    pureGrams,
    netGold,
    makingFee,
    shopMarkup,
    duties: afterDuty - preTax,
    taxes: totalUsd - afterDuty,
    totalUsd,
    totalLocal: totalUsd * country.rate,
    premiumPct,
    breakEvenPerG,
    breakEvenPerPureG,
    askingPremium,
  };
}

/** Landed cost of 1g pure gold in a country (no fees). */
export function landedPerGram(country: Country, spotUsdOz: number, basis: Basis = "raw", fineness = 1) {
  return (
    (spotUsdOz / GRAMS_PER_OUNCE) * fineness * (1 + premiumOf(country, basis) / 100) *
    (1 + country.duty / 100) * (1 + country.tax / 100)
  );
}

/** Cheapest country for the current trade. */
export function cheapestOf(countries: Country[], trade: Trade, spotUsdOz: number, basis: Basis = "raw") {
  let best: { c: Country; r: ReturnType<typeof analyze> } | null = null;
  for (const c of countries) {
    const r = analyze(trade, c, spotUsdOz, basis);
    if (!best || r.totalUsd < best.r.totalUsd) best = { c, r };
  }
  return best;
}

export function fmt(n: number, currency = "USD", decimals = 2) {
  if (!isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
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
