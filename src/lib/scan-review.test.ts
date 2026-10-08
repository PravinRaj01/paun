import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type Country, type Settings } from "./gold";
import type { ScanItemRead, ScanResponse } from "./scan";
import {
  blankRow,
  loadReview,
  paidSum,
  reviewIsValid,
  rowProblems,
  rowsToVaultItems,
  saveReview,
  scanToReview,
  totalsDiffer,
  type Review,
  type ReviewRow,
} from "./scan-review";

const countries: Country[] = [
  { id: "my", name: "Malaysia", currency: "MYR", rate: 4.5, duty: 0, tax: 0 },
  { id: "sg", name: "Singapore", currency: "SGD", rate: 1.3, duty: 0, tax: 0 },
];
const myr: Settings = { ...DEFAULT_SETTINGS, baseCurrency: "MYR" };
const usd: Settings = { ...DEFAULT_SETTINGS, baseCurrency: "USD" };
const TODAY = "2026-10-08";
let n = 0;
const ctx = (settings: Settings) => ({ settings, countries, newId: () => `id${++n}`, today: TODAY });

const item = (over: Partial<ScanItemRead> = {}): ScanItemRead => ({
  itemName: "Gold Bar",
  purity: "999.9",
  weightGrams: 200,
  makingFee: null,
  lineTotal: 21060,
  ...over,
});
const res = (items: ScanItemRead[], over: Partial<ScanResponse["receipt"]> = {}, confidence: ScanResponse["confidence"] = "high") => ({
  confidence,
  receipt: { purchaseDate: "2008-12-18", totalPaid: 30507, currency: "MYR", ...over },
  items,
});

describe("scanToReview: several pieces on one receipt", () => {
  const three = res([item(), item({ weightGrams: 40, lineTotal: 4212 }), item({ weightGrams: 50, lineTotal: 5235 })]);

  it("makes one editable row per piece, each with its own weight and price", () => {
    const r = scanToReview(three, ctx(myr));
    expect(r.rows.map((x) => [x.weight, x.paid])).toEqual([["200", "21060"], ["40", "4212"], ["50", "5235"]]);
    expect(new Set(r.rows.map((x) => x.id)).size).toBe(3);
  });

  it("puts the receipt's date on every row and keeps the receipt total for comparison", () => {
    const r = scanToReview(three, ctx(myr));
    expect(r.rows.every((x) => x.date === "2008-12-18")).toBe(true);
    expect(r.dateFromReceipt).toBe(true);
    expect(r.receiptTotal).toBe(30507);
  });

  it("with no per-line prices on a multi-piece receipt, the prices stay blank (the total is not split by guesswork)", () => {
    const r = scanToReview(res([item({ lineTotal: null }), item({ lineTotal: null })]), ctx(myr));
    expect(r.rows.map((x) => x.paid)).toEqual(["", ""]);
    expect(r.receiptTotal).toBe(30507);
  });
});

describe("scanToReview: one piece", () => {
  it("takes the receipt total as its price when no line price is printed", () => {
    const r = scanToReview(res([item({ lineTotal: null })], { totalPaid: 9721 }), ctx(myr));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.paid).toBe("9721");
  });

  it("prefers the receipt's grand total over the line amount (the total is what was actually paid)", () => {
    expect(scanToReview(res([item({ lineTotal: 9720.6 })], { totalPaid: 9721 }), ctx(myr)).rows[0]!.paid).toBe("9721");
  });

  it("falls back to the line amount when the receipt prints no grand total", () => {
    expect(scanToReview(res([item({ lineTotal: 9720.6 })], { totalPaid: null }), ctx(myr)).rows[0]!.paid).toBe("9720.6");
  });
});

describe("scanToReview: reading what is missing", () => {
  it("an unread purity stays empty so the user has to choose (it is never turned into 916)", () => {
    const r = scanToReview(res([item({ purity: null })]), ctx(myr));
    expect(r.rows[0]!.purity).toBe("");
    expect(reviewIsValid(r.rows)).toBe(false);
  });

  it("no date on the receipt means today, and the page is told so", () => {
    const r = scanToReview(res([item()], { purchaseDate: null }), ctx(myr));
    expect(r.rows[0]!.date).toBe(TODAY);
    expect(r.dateFromReceipt).toBe(false);
  });

  it("no pieces found gives one blank row to fill in by hand", () => {
    const r = scanToReview(res([]), ctx(myr));
    expect(r.rows).toEqual([{ id: expect.any(String), name: "", weight: "", purity: "", paid: "", date: "2008-12-18" }]);
  });
});

describe("scanToReview: currencies (the watchlist's rate, never a guess)", () => {
  it("converts a receipt in another currency into the base currency", () => {
    // 130 SGD = 100 USD = 450 MYR
    const r = scanToReview(res([item({ lineTotal: 130 })], { totalPaid: 130, currency: "SGD" }), ctx(myr));
    expect(r.rows[0]!.paid).toBe("450");
    expect(r.receiptTotal).toBe(450);
    expect(scanToReview(res([item({ lineTotal: 130 })], { totalPaid: 130, currency: "SGD" }), ctx(usd)).rows[0]!.paid).toBe("100");
  });

  it("an unknown currency leaves prices blank and names the currency", () => {
    const r = scanToReview(res([item({ lineTotal: 5000 })], { totalPaid: 5000, currency: "THB" }), ctx(myr));
    expect(r.rows[0]!.paid).toBe("");
    expect(r.unknownCurrency).toBe("THB");
    expect(r.receiptTotal).toBeNull();
  });

  it("a receipt with no currency printed is taken to be in the user's own", () => {
    expect(scanToReview(res([item({ lineTotal: 100 })], { currency: null, totalPaid: 100 }), ctx(myr)).rows[0]!.paid).toBe("100");
  });

  it("rounds to two decimals", () => {
    expect(scanToReview(res([item({ lineTotal: 100 })], { currency: "SGD", totalPaid: 100 }), ctx(myr)).rows[0]!.paid).toBe("346.15");
  });
});

const row = (over: Partial<ReviewRow> = {}): ReviewRow => ({ id: "r", name: "", weight: "12.5", purity: "916", paid: "6000", date: "2026-09-30", ...over });

describe("rowProblems and reviewIsValid", () => {
  it("a complete row has no problems", () => expect(rowProblems(row())).toEqual([]));

  it.each([
    ["no weight", { weight: "" }, ["weight"]],
    ["a zero weight", { weight: "0" }, ["weight"]],
    ["a negative weight", { weight: "-3" }, ["weight"]],
    ["a weight that is text", { weight: "abc" }, ["weight"]],
    ["no purity chosen", { purity: "" as const }, ["purity"]],
    ["a negative price", { paid: "-1" }, ["paid"]],
    ["a price that is text", { paid: "lots" }, ["paid"]],
    ["a date that does not exist", { date: "2026-02-31" }, ["date"]],
    ["a date in the wrong format", { date: "30/09/2026" }, ["date"]],
    ["several at once", { weight: "", purity: "" as const }, ["weight", "purity"]],
  ])("flags %s", (_n, over, expected) => expect(rowProblems(row(over))).toEqual(expected));

  it("a blank price is allowed (it means unknown and is stored as 0)", () => expect(rowProblems(row({ paid: "" }))).toEqual([]));

  it("a review is valid only when it has rows and every row is valid", () => {
    expect(reviewIsValid([])).toBe(false);
    expect(reviewIsValid([row(), row({ id: "b" })])).toBe(true);
    expect(reviewIsValid([row(), row({ id: "b", weight: "" })])).toBe(false);
  });
});

describe("rowsToVaultItems (the same maths as the manual add form)", () => {
  it("stores the price in USD (typed price divided by the base rate), keeps weight, purity and date", () => {
    const [a] = rowsToVaultItems([row({ name: "Rantai", weight: "12.5", paid: "450" })], 4.5, () => "new1");
    expect(a).toEqual({ id: "new1", name: "Rantai", weight: 12.5, purity: "916", paidUsd: 100, date: "2026-09-30" });
  });

  it("names an unnamed piece '12.5 g 916', and stores a blank price as 0", () => {
    const [a] = rowsToVaultItems([row({ name: "  ", paid: "" })], 4.5, () => "x");
    expect(a).toMatchObject({ name: "12.5 g 916", paidUsd: 0 });
  });

  it("builds one item per row with a fresh id each, in order", () => {
    let k = 0;
    const items = rowsToVaultItems([row({ id: "a", weight: "1" }), row({ id: "b", weight: "2" }), row({ id: "c", weight: "3" })], 1, () => `v${++k}`);
    expect(items.map((i) => [i.id, i.weight])).toEqual([["v1", 1], ["v2", 2], ["v3", 3]]);
  });
});

describe("the receipt total check", () => {
  it("is quiet when the prices add up (within 1%)", () => {
    expect(totalsDiffer([row({ paid: "21060" }), row({ paid: "4212" }), row({ paid: "5235" })], 30507)).toBe(false);
    expect(totalsDiffer([row({ paid: "100" }), row({ paid: "100.5" })], 200)).toBe(false);
  });

  it("speaks up when they clearly do not (a misread line, or a charge that is not a piece)", () => {
    expect(totalsDiffer([row({ paid: "31060" }), row({ paid: "4212" }), row({ paid: "5235" })], 30507)).toBe(true);
  });

  it("is not judged with fewer than two priced rows, or without a receipt total", () => {
    expect(totalsDiffer([row({ paid: "5" })], 30507)).toBe(false);
    expect(totalsDiffer([row({ paid: "5" }), row({ paid: "" })], 30507)).toBe(false);
    expect(totalsDiffer([row({ paid: "5" }), row({ paid: "6" })], null)).toBe(false);
  });

  it("paidSum ignores blanks and unreadable entries", () => expect(paidSum([row({ paid: "10.5" }), row({ paid: "" }), row({ paid: "x" })])).toBe(10.5));
});

describe("blankRow", () => {
  it("is empty apart from its id and date", () => expect(blankRow("z", "2026-01-01")).toEqual({ id: "z", name: "", weight: "", purity: "", paid: "", date: "2026-01-01" }));
});

describe("a pending review survives a page refresh (sessionStorage, fields only)", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const review = (): Review => ({ rows: [row({ id: "a" }), row({ id: "b", purity: "" })], receiptTotal: 30507, confidence: "medium", unknownCurrency: null, dateFromReceipt: true });

  it("saves and loads the same review", () => {
    saveReview(review());
    expect(loadReview()).toEqual(review());
  });

  it("saving null clears it", () => {
    saveReview(review());
    saveReview(null);
    expect(loadReview()).toBeNull();
  });

  it("never stores a photo: only the row fields and a few receipt facts", () => {
    saveReview(review());
    const raw = [...store.values()].join("");
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["confidence", "dateFromReceipt", "receiptTotal", "rows", "unknownCurrency"]);
  });

  it.each([
    ["not JSON", "{oops"],
    ["no rows", JSON.stringify({ rows: [] })],
    ["a row missing fields", JSON.stringify({ rows: [{ id: "a" }] })],
    ["an unknown purity", JSON.stringify({ rows: [{ id: "a", name: "", weight: "1", purity: "925", paid: "", date: "2026-01-01" }] })],
    ["a list that is far too long", JSON.stringify({ rows: Array.from({ length: 60 }, (_v, i) => ({ id: String(i), name: "", weight: "1", purity: "916", paid: "", date: "2026-01-01" })) })],
  ])("ignores damaged data (%s) instead of trusting it", (_n, raw) => {
    store.set("gold-assistant:scan-review", raw);
    expect(loadReview()).toBeNull();
  });

  it("does nothing, and does not throw, when storage is blocked", () => {
    const blocked = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); }, removeItem: () => { throw new Error("no"); } };
    vi.stubGlobal("sessionStorage", blocked);
    expect(() => saveReview(review())).not.toThrow();
    expect(loadReview()).toBeNull();
  });
});
