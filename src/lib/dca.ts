import {
  DEFAULT_TRADE,
  GRAMS_PER_OUNCE,
  fineOf,
  landedPerGram,
  sellQuote,
  type Basis,
  type Country,
  type PurityId,
} from "./gold";

/**
 * Dollar-cost-averaging backtest: "what if I had bought gold every month, versus putting the same cash in a savings account?"
 *
 * Rules (also written in PLAN.md, section 3C):
 *  - One purchase on the FIRST TRADING DAY of each of the last N calendar months, the current month included.
 *  - The price is that day's gold close, then the same shop mark-up / duty / tax factors the app uses for any purchase
 *    (`landedPerGram`). Making fees and melting are not modelled (melting never applies when buying).
 *  - The savings comparison deposits the SAME cash on the SAME dates. Interest is nominal annual / 12, credited at each month
 *    end, so a deposit made in the current month has earned nothing yet.
 *  - Everything is computed in USD, then shown in the base currency. USD/MYR is historical when the base currency is MYR;
 *    other currencies use today's rate for every date (the snapshot has no history for them), and the result says so.
 *  - The earliest month in the data is treated as partial (we cannot know its true first trading day) and never used.
 *
 * A backtest is not a forecast: it replays the past, which here includes a large gold rally.
 */
export type DcaHistory = {
  dates: string[]; // "YYYY-MM-DD", ascending, one per gold trading day
  xau: (number | null)[]; // USD per troy ounce
  usdmyr: (number | null)[]; // MYR per 1 USD
};

export type DcaContribution = { mode: "grams"; grams: number } | { mode: "amount"; amount: number };

export type DcaParams = {
  months: number; // number of monthly purchases wanted (12 / 36 / 60)
  contribution: DcaContribution; // grams of the piece per month, or cash per month in the base currency
  purity: PurityId;
  country: Country;
  basis: Basis; // "retail" adds shop mark-up when buying and the susut deduction when selling back
  savingsRatePct: number; // nominal annual %, compounded monthly
  baseCurrency: string;
  baseRateToday: number; // local units per 1 USD today; used for currencies other than USD and MYR
  deductionPct: number; // susut when selling back (retail basis only)
};

export type FxMode = "usd" | "historical" | "today";

export type DcaPurchase = {
  date: string;
  xauUsd: number;
  fxPerUsd: number;
  grams: number; // grams of the piece bought
  costUsd: number;
  costBase: number;
};

export type DcaPoint = { date: string; invested: number; goldValue: number; savings: number }; // base currency

export type DcaResult = {
  ok: true;
  purchases: DcaPurchase[];
  series: DcaPoint[];
  requestedMonths: number;
  purchaseCount: number;
  clamped: boolean; // fewer purchases than requested (not enough data, or a month had no trading day)
  firstDate: string;
  endDate: string;
  fxMode: FxMode;
  fxEnd: number; // local units per USD used to value the gold today
  totalGrams: number;
  totalPureGrams: number;
  investedBase: number;
  avgCostPerGramBase: number; // per gram of the piece bought
  avgCostPerPureGramBase: number;
  valueAtSpotBase: number;
  valueSellBackBase: number; // after susut on the retail basis; equals valueAtSpotBase on the raw basis
  profitAtSpotBase: number;
  profitSellBackBase: number;
  savingsBase: number;
  goldVsSavingsBase: number; // sell-back value minus savings balance (positive = gold ahead)
};

export type DcaError = { ok: false; error: "invalidContribution" | "invalidRate" | "noData" };

const monthKey = (date: string) => date.slice(0, 7);
const monthIndex = (key: string) => Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1;

export function backtestDca(history: DcaHistory, p: DcaParams): DcaResult | DcaError {
  const amount = p.contribution.mode === "grams" ? p.contribution.grams : p.contribution.amount;
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "invalidContribution" };
  if (!Number.isFinite(p.savingsRatePct) || p.savingsRatePct <= -100)
    return { ok: false, error: "invalidRate" };
  const months = Math.floor(p.months);
  if (!(months >= 1)) return { ok: false, error: "noData" };

  const fxMode: FxMode =
    p.baseCurrency === "USD" ? "usd" : p.baseCurrency === "MYR" ? "historical" : "today";
  const rows: { date: string; xau: number; fx: number }[] = [];
  history.dates.forEach((date, i) => {
    const xau = history.xau[i];
    if (xau == null || !Number.isFinite(xau) || xau <= 0) return;
    const myr = history.usdmyr[i];
    const fx =
      fxMode === "usd"
        ? 1
        : fxMode === "today"
          ? p.baseRateToday
          : myr != null && Number.isFinite(myr) && myr > 0
            ? myr
            : NaN;
    if (Number.isFinite(fx) && fx > 0) rows.push({ date, xau, fx });
  });
  if (rows.length < 2) return { ok: false, error: "noData" };

  // first trading day of each month present in the data; the earliest month may be partial, so it is never used
  const firstOfMonth = new Map<string, (typeof rows)[number]>();
  for (const r of rows)
    if (!firstOfMonth.has(monthKey(r.date))) firstOfMonth.set(monthKey(r.date), r);
  const firstMonth = monthKey(rows[0]!.date);
  const end = rows[rows.length - 1]!;
  const endIdx = monthIndex(monthKey(end.date));

  const fine = fineOf(p.purity);
  const rm = p.savingsRatePct / 100 / 12; // monthly interest rate
  const purchases: DcaPurchase[] = [];
  const idxs: number[] = [];
  for (let idx = endIdx - months + 1; idx <= endIdx; idx++) {
    const key = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
    const row = firstOfMonth.get(key);
    if (!row || key === firstMonth) continue;
    const perGramUsd = landedPerGram(p.country, row.xau, p.basis, fine); // USD per gram of the piece, all-in
    const costUsd =
      p.contribution.mode === "grams"
        ? p.contribution.grams * perGramUsd
        : p.contribution.amount / row.fx;
    const grams = p.contribution.mode === "grams" ? p.contribution.grams : costUsd / perGramUsd;
    purchases.push({
      date: row.date,
      xauUsd: row.xau,
      fxPerUsd: row.fx,
      grams,
      costUsd,
      costBase: costUsd * row.fx,
    });
    idxs.push(idx);
  }
  if (purchases.length === 0) return { ok: false, error: "noData" };

  const savingsAt = (uptoCount: number, atIdx: number) =>
    purchases
      .slice(0, uptoCount)
      .reduce((sum, b, j) => sum + b.costBase * (1 + rm) ** (atIdx - idxs[j]!), 0);

  const series: DcaPoint[] = [];
  let grams = 0;
  let invested = 0;
  purchases.forEach((b, k) => {
    grams += b.grams;
    invested += b.costBase;
    series.push({
      date: b.date,
      invested,
      goldValue: grams * fine * (b.xauUsd / GRAMS_PER_OUNCE) * b.fxPerUsd,
      savings: savingsAt(k + 1, idxs[k]!),
    });
  });

  const totalGrams = grams;
  const totalPure = totalGrams * fine;
  const valueSpotUsd = totalPure * (end.xau / GRAMS_PER_OUNCE);
  const valueAtSpotBase = valueSpotUsd * end.fx;
  const sellUsd =
    p.basis === "retail"
      ? sellQuote(
          {
            ...DEFAULT_TRADE,
            weight: totalGrams,
            purity: p.purity,
            melting: 0,
            deduction: p.deductionPct,
          },
          end.xau,
        ).payout
      : valueSpotUsd;
  const valueSellBackBase = sellUsd * end.fx;
  const savingsBase = savingsAt(purchases.length, endIdx);
  if (series[series.length - 1]!.date !== end.date) {
    series.push({ date: end.date, invested, goldValue: valueAtSpotBase, savings: savingsBase });
  }

  return {
    ok: true,
    purchases,
    series,
    requestedMonths: months,
    purchaseCount: purchases.length,
    clamped: purchases.length < months,
    firstDate: purchases[0]!.date,
    endDate: end.date,
    fxMode,
    fxEnd: end.fx,
    totalGrams,
    totalPureGrams: totalPure,
    investedBase: invested,
    avgCostPerGramBase: invested / totalGrams,
    avgCostPerPureGramBase: invested / totalPure,
    valueAtSpotBase,
    valueSellBackBase,
    profitAtSpotBase: valueAtSpotBase - invested,
    profitSellBackBase: valueSellBackBase - invested,
    savingsBase,
    goldVsSavingsBase: valueSellBackBase - savingsBase,
  };
}
