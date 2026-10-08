import { baseRateOf, PURITIES, type Country, type PurityId, type Settings, type VaultItem } from "./gold";
import { localToday } from "./datetime";
import type { ScanResponse } from "./scan";

/**
 * The review step after a scan (PLAN.md 4.7). A receipt can list several gold pieces, so the scanner's answer becomes a list of
 * EDITABLE ROWS the user checks, removes, adds to and only then adds to the Vault. Nothing here saves anything: `rowsToVaultItems`
 * only builds the items, and the page decides when.
 *
 * Money in a row is typed in the user's BASE currency (like the manual add form); `rowsToVaultItems` turns it into stored USD.
 */
export type ReviewRow = {
  id: string;
  name: string;
  weight: string; // grams, as typed
  purity: PurityId | ""; // "" = the scanner could not read it; the user must choose (never silently 916)
  paid: string; // base currency, as typed; blank means "not known" and is stored as 0
  date: string; // YYYY-MM-DD, the user's local calendar date or the receipt's printed date
};

export type Review = {
  rows: ReviewRow[];
  /** The receipt's grand total in the base currency, for comparison; null when not printed or the currency has no rate. */
  receiptTotal: number | null;
  confidence: "high" | "medium" | "low";
  /** The receipt is in a currency with no rate in the watchlist, so prices were left blank. */
  unknownCurrency: string | null;
  /** False when the receipt showed no date, so rows carry today's date and the user should check it. */
  dateFromReceipt: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const text = (n: number) => String(round2(n));

export const blankRow = (id: string, date: string): ReviewRow => ({ id, name: "", weight: "", purity: "", paid: "", date });

/** Turn the scanner's answer into rows. Never guesses a rate: an amount in an unknown currency is left blank and reported. */
export function scanToReview(
  res: Pick<ScanResponse, "confidence" | "receipt" | "items">,
  ctx: { settings: Settings; countries: Country[]; newId: () => string; today?: string },
): Review {
  const today = ctx.today ?? localToday();
  const baseCurrency = ctx.settings.baseCurrency;
  const code = res.receipt.currency ?? baseCurrency; // a receipt with no currency printed is taken to be in the user's own
  let unknownCurrency: string | null = null;
  const toBase = (amount: number): number | null => {
    if (code === baseCurrency) return amount;
    const rate = code === "USD" ? 1 : ctx.countries.find((c) => c.currency === code)?.rate;
    if (rate && rate > 0) return (amount / rate) * baseRateOf(ctx.settings, ctx.countries);
    unknownCurrency = code;
    return null;
  };
  const receiptTotal = res.receipt.totalPaid !== null ? toBase(res.receipt.totalPaid) : null;
  const date = res.receipt.purchaseDate ?? today;
  const single = res.items.length === 1;

  const rows: ReviewRow[] = res.items.map((it) => {
    // one piece: the receipt's grand total is what was actually paid (it can differ slightly from the line, e.g. after a discount);
    // several pieces: each line's own amount, or blank (the total is never split by guesswork)
    const line = single && receiptTotal !== null ? receiptTotal : it.lineTotal !== null ? toBase(it.lineTotal) : null;
    return {
      id: ctx.newId(),
      name: it.itemName ?? "",
      weight: it.weightGrams !== null ? String(it.weightGrams) : "",
      purity: it.purity ?? "",
      paid: line !== null ? text(line) : "",
      date,
    };
  });
  return {
    rows: rows.length ? rows : [blankRow(ctx.newId(), date)],
    receiptTotal: receiptTotal !== null ? round2(receiptTotal) : null,
    confidence: res.confidence,
    unknownCurrency,
    dateFromReceipt: res.receipt.purchaseDate !== null,
  };
}

export type RowProblem = "weight" | "purity" | "paid" | "date";

const isRealDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s;
};

/** What stops a row being added. A blank price is allowed (stored as 0, "unknown"); a typed price must be a number of at least 0. */
export function rowProblems(row: ReviewRow): RowProblem[] {
  const problems: RowProblem[] = [];
  const w = Number(row.weight);
  if (!(row.weight.trim() !== "" && Number.isFinite(w) && w > 0)) problems.push("weight");
  if (!PURITIES.some((p) => p.id === row.purity)) problems.push("purity");
  if (row.paid.trim() !== "" && !(Number.isFinite(Number(row.paid)) && Number(row.paid) >= 0)) problems.push("paid");
  if (!isRealDate(row.date)) problems.push("date");
  return problems;
}
export const reviewIsValid = (rows: ReviewRow[]) => rows.length > 0 && rows.every((r) => rowProblems(r).length === 0);

/** The same maths as the manual add form: the price is typed in the base currency and stored in USD. */
export function rowsToVaultItems(rows: ReviewRow[], baseRate: number, newId: () => string): VaultItem[] {
  return rows.map((r) => {
    const weight = Number(r.weight);
    const purity = r.purity as PurityId;
    return {
      id: newId(),
      name: r.name.trim() || `${weight} g ${purity}`,
      weight,
      purity,
      paidUsd: r.paid.trim() === "" ? 0 : Math.max(0, Number(r.paid) / baseRate),
      date: r.date,
    };
  });
}

/** Sum of the typed prices (base currency), ignoring blanks and unreadable entries. */
export const paidSum = (rows: ReviewRow[]) => round2(rows.reduce((a, r) => (Number.isFinite(Number(r.paid)) ? a + Number(r.paid) : a), 0));

/**
 * True when the rows' prices clearly do not add up to the receipt total, which usually means a misread line or a charge
 * (transport, tax) that is not a piece. Only judged when the receipt total is known and at least two rows have a price,
 * and allows 1% (or 1 currency unit) for rounding.
 */
export function totalsDiffer(rows: ReviewRow[], receiptTotal: number | null): boolean {
  if (receiptTotal === null || rows.filter((r) => r.paid.trim() !== "").length < 2) return false;
  return Math.abs(paidSum(rows) - receiptTotal) > Math.max(1, receiptTotal * 0.01);
}

// ---- keeping a pending review across a page refresh (sessionStorage; only the fields, never the photo) ----
const NAME = "gold-assistant:scan-review";

export function saveReview(review: Review | null): void {
  try {
    if (!review) sessionStorage.removeItem(NAME);
    else sessionStorage.setItem(NAME, JSON.stringify(review));
  } catch {
    /* storage blocked: the review simply is not kept across a refresh */
  }
}

const str = (v: unknown): v is string => typeof v === "string";

/** Read it back defensively: anything malformed is ignored rather than trusted. */
export function loadReview(): Review | null {
  try {
    const raw = sessionStorage.getItem(NAME);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Review> | null;
    if (!v || !Array.isArray(v.rows) || v.rows.length === 0 || v.rows.length > 50) return null;
    const rows: ReviewRow[] = [];
    for (const r of v.rows as Partial<ReviewRow>[]) {
      if (!r || !str(r.id) || !str(r.name) || !str(r.weight) || !str(r.paid) || !str(r.date)) return null;
      if (r.purity !== "" && !PURITIES.some((p) => p.id === r.purity)) return null;
      rows.push({ id: r.id, name: r.name.slice(0, 80), weight: r.weight.slice(0, 20), purity: r.purity as PurityId | "", paid: r.paid.slice(0, 20), date: r.date });
    }
    const confidence = v.confidence === "high" || v.confidence === "medium" ? v.confidence : "low";
    return {
      rows,
      receiptTotal: typeof v.receiptTotal === "number" && Number.isFinite(v.receiptTotal) ? v.receiptTotal : null,
      confidence,
      unknownCurrency: str(v.unknownCurrency) ? v.unknownCurrency : null,
      dateFromReceipt: v.dateFromReceipt === true,
    };
  } catch {
    return null;
  }
}
