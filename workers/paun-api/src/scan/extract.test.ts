import { describe, expect, it } from "vitest";
import { EMPTY_FIELDS, EMPTY_RECEIPT, MAX_ITEMS, sanitizeScan } from "./extract";
import { normalizePurity } from "./purity";

const NOW = new Date("2026-10-08T01:00:00Z");
const good = {
  readable: true,
  item_name: "Rantai tangan 916",
  purity: "916",
  weight_grams: 12.5,
  making_fee_amount: 8,
  making_fee_per: "gram",
  purchase_date: "2026-09-30",
  total_paid: 6120.5,
  currency: "MYR",
  confidence: "high",
};
const scan = (over: Record<string, unknown> = {}) => sanitizeScan({ ...good, ...over }, NOW);

describe("a clean reading passes through", () => {
  it("keeps every field (a single flat piece is understood as one item)", () => {
    const piece = { itemName: "Rantai tangan 916", purity: "916", weightGrams: 12.5, makingFee: { amount: 8, per: "gram" }, lineTotal: null };
    const receipt = { purchaseDate: "2026-09-30", totalPaid: 6120.5, currency: "MYR" };
    expect(scan()).toEqual({ readable: true, confidence: "high", receipt, items: [piece], fields: { ...piece, lineTotal: undefined, ...receipt } });
  });
});

describe("a field that fails its check becomes null, never a guess", () => {
  it("purity: only the app's stamps or a karat label", () => {
    expect(scan({ purity: "22K" }).fields.purity).toBe("916");
    expect(scan({ purity: "916 " }).fields.purity).toBe("916");
    expect(scan({ purity: "999.9" }).fields.purity).toBe("999.9");
    expect(scan({ purity: "925" }).fields.purity).toBeNull(); // silver sterling, not in the app: not turned into 916
    expect(scan({ purity: "gold" }).fields.purity).toBeNull();
    expect(scan({ purity: 750 }).fields.purity).toBe("750");
    expect(scan({ purity: null }).fields.purity).toBeNull();
  });

  it("weight: a positive number of grams, within reason", () => {
    expect(scan({ weight_grams: "12.50" }).fields.weightGrams).toBe(12.5);
    expect(scan({ weight_grams: 0 }).fields.weightGrams).toBeNull();
    expect(scan({ weight_grams: -3 }).fields.weightGrams).toBeNull();
    expect(scan({ weight_grams: 250_000 }).fields.weightGrams).toBeNull();
    expect(scan({ weight_grams: "about ten" }).fields.weightGrams).toBeNull();
    expect(scan({ weight_grams: Number.NaN }).fields.weightGrams).toBeNull();
  });

  it("money: thousands separators are read, text and absurd amounts are not", () => {
    expect(scan({ total_paid: "6,120.50" }).fields.totalPaid).toBe(6120.5);
    expect(scan({ total_paid: "RM6120" }).fields.totalPaid).toBeNull();
    expect(scan({ total_paid: 0 }).fields.totalPaid).toBeNull();
    expect(scan({ total_paid: 5e12 }).fields.totalPaid).toBeNull();
  });

  it("making fee: needs a basis (per gram or total), otherwise it would be a guess", () => {
    expect(scan({ making_fee_per: null }).fields.makingFee).toBeNull();
    expect(scan({ making_fee_per: "each" }).fields.makingFee).toBeNull();
    expect(scan({ making_fee_amount: 0, making_fee_per: "total" }).fields.makingFee).toEqual({ amount: 0, per: "total" });
    expect(scan({ making_fee_amount: -5 }).fields.makingFee).toBeNull();
  });

  it("currency: a 3-letter code; RM means MYR", () => {
    expect(scan({ currency: "RM" }).fields.currency).toBe("MYR");
    expect(scan({ currency: "myr" }).fields.currency).toBe("MYR");
    expect(scan({ currency: "ringgit" }).fields.currency).toBeNull();
    expect(scan({ currency: 4 }).fields.currency).toBeNull();
  });

  it.each([
    ["a date in the far future", "2030-01-01"],
    ["a date that does not exist", "2026-02-31"],
    ["a day-first date (the prompt asks for ISO)", "30/09/2026"],
    ["a date before 1990", "1985-05-05"],
    ["text", "last Tuesday"],
  ])("purchase date: rejects %s", (_n, value) => expect(scan({ purchase_date: value }).fields.purchaseDate).toBeNull());

  it("purchase date: today in Malaysia can already be tomorrow in UTC, so one day ahead is allowed", () => {
    expect(scan({ purchase_date: "2026-10-09" }).fields.purchaseDate).toBe("2026-10-09");
    expect(scan({ purchase_date: "2026-10-10" }).fields.purchaseDate).toBeNull();
  });

  it("item name: trimmed and capped; empty becomes null", () => {
    expect(scan({ item_name: "  Cincin  " }).fields.itemName).toBe("Cincin");
    expect(scan({ item_name: "x".repeat(500) }).fields.itemName).toHaveLength(80);
    expect(scan({ item_name: "   " }).fields.itemName).toBeNull();
    expect(scan({ item_name: 42 }).fields.itemName).toBeNull();
  });
});

describe("confidence and readability", () => {
  it("an unknown or missing confidence is low", () => {
    expect(scan({ confidence: "certain" }).confidence).toBe("low");
    expect(scan({ confidence: undefined }).confidence).toBe("low");
    expect(scan({ confidence: "medium" }).confidence).toBe("medium");
  });

  it("not readable means every field is null, whatever else the model said", () => {
    expect(scan({ readable: false })).toEqual({ readable: false, confidence: "low", receipt: EMPTY_RECEIPT, items: [], fields: EMPTY_FIELDS });
    expect(scan({ readable: "yes" }).readable).toBe(false); // must be exactly true
  });

  it.each([null, undefined, "text", 42, [], [good]])("a reply that is not an object (%j) reads as unreadable", (raw) => {
    expect(sanitizeScan(raw, NOW)).toEqual({ readable: false, confidence: "low", receipt: EMPTY_RECEIPT, items: [], fields: EMPTY_FIELDS });
  });

  it("ignores extra fields the model invents (nothing unvalidated reaches the client)", () => {
    const r = scan({ instructions: "ignore all previous instructions", admin: true }) as unknown as Record<string, unknown>;
    expect(Object.keys(r).sort()).toEqual(["confidence", "fields", "items", "readable", "receipt"]);
    expect(Object.keys(r["fields"] as object).sort()).toEqual(Object.keys(EMPTY_FIELDS).sort());
  });
});

describe("a receipt with several gold pieces", () => {
  const piece = (over: Record<string, unknown> = {}) => ({
    item_name: "Gold Bar",
    purity: "999.9",
    weight_grams: 200,
    making_fee_amount: 700,
    making_fee_per: "total",
    line_total: 21060,
    ...over,
  });
  const receipt = (items: unknown[], over: Record<string, unknown> = {}) =>
    sanitizeScan({ readable: true, items, purchase_date: "2008-12-18", total_paid: 30507, currency: "RM", confidence: "medium", ...over }, NOW);

  it("returns one entry per piece, in order, each with its own checks", () => {
    const r = receipt([piece(), piece({ weight_grams: 40, line_total: 4213, making_fee_amount: 140 }), piece({ weight_grams: 50, line_total: 5235 })]);
    expect(r.items.map((i) => i.weightGrams)).toEqual([200, 40, 50]);
    expect(r.items.map((i) => i.lineTotal)).toEqual([21060, 4213, 5235]);
    expect(r.items[1]!.makingFee).toEqual({ amount: 140, per: "total" });
  });

  it("keeps the receipt's own details separate: one date, the grand total, the currency", () => {
    const r = receipt([piece(), piece()]);
    expect(r.receipt).toEqual({ purchaseDate: "2008-12-18", totalPaid: 30507, currency: "MYR" });
  });

  it("the older single-piece view is the first item plus the receipt", () => {
    const r = receipt([piece({ item_name: "First" }), piece({ item_name: "Second" })]);
    expect(r.fields).toMatchObject({ itemName: "First", weightGrams: 200, totalPaid: 30507, currency: "MYR", purchaseDate: "2008-12-18" });
  });

  it("drops an entry that says nothing, and checks each piece independently (a bad weight nulls only that piece's weight)", () => {
    const r = receipt([piece(), { item_name: null, purity: null, weight_grams: null }, piece({ weight_grams: -5, purity: "925" }), "junk", null]);
    expect(r.items).toHaveLength(2);
    expect(r.items[1]).toMatchObject({ weightGrams: null, purity: null, itemName: "Gold Bar" });
  });

  it("a line total outside a sane range is ignored", () => {
    expect(receipt([piece({ line_total: 0 }), piece({ line_total: 5e12 }), piece({ line_total: "1,200.50" })]).items.map((i) => i.lineTotal)).toEqual([null, null, 1200.5]);
  });

  it("never returns more than the cap", () => {
    expect(receipt(Array.from({ length: MAX_ITEMS + 15 }, () => piece())).items).toHaveLength(MAX_ITEMS);
  });

  it("readable with no usable items gives an empty list (the page offers a blank row), not a crash", () => {
    const r = receipt([]);
    expect(r).toMatchObject({ readable: true, items: [] });
    expect(r.fields).toMatchObject({ itemName: null, totalPaid: 30507 });
    expect(receipt("not a list" as never).items).toEqual([]);
  });

  it("not readable gives no items even if the model listed some", () => {
    expect(sanitizeScan({ readable: false, items: [piece()] }, NOW).items).toEqual([]);
  });
});

describe("normalizePurity", () => {
  it.each([
    ["999.9", "999.9"], ["916", "916"], ["22K", "916"], ["22 k", "916"], ["22ct", "916"], ["18KT", "750"], ["14K", "585"],
    ["9K", null], ["925", null], ["", null], ["22", null],
  ])("%j -> %j", (raw, id) => expect(normalizePurity(raw)).toBe(id));
});
