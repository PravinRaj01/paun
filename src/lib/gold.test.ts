import { describe, expect, it } from "vitest";
import * as gold from "./gold";
import { COUNTRY_CATALOG } from "./country-catalog";
import {
  ADDS_UP_TOLERANCE,
  DEFAULT_COUNTRIES,
  DEFAULT_SETTINGS,
  DEFAULT_TRADE,
  GRAMS_PER_OUNCE,
  SHIPPED_RATES,
  baseRateOf,
  buyCheck,
  clearTradeMoney,
  compareQuotes,
  convertTradeMoney,
  countryEstimate,
  effectiveCountry,
  effectiveRate,
  estimateSell,
  fineOf,
  fmt,
  hasDefaultSpot,
  karatOf,
  landedPerGram,
  metalPerGram,
  currencyRate,
  migrateVaultPaid,
  paidInDisplay,
  normPurity,
  parsePurity,
  pieceValue,
  premiumOf,
  purityLabel,
  rateKnown,
  rawGoldValue,
  sellCheck,
  type Country,
} from "./gold";

/**
 * Every expected number below comes from the worked examples in docs/calculations.md, calculated by hand from these inputs
 * (gold 4,187 USD/oz and USD/MYR 4.0983, as published 13-14 Oct 2026), not copied from the code's output.
 */
const USD_OZ = 4187;
const FX = 4.0983;
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 1); // within RM 0.05

describe("raw gold value (spec section 2)", () => {
  it("example 2.1: metal per gram and a 10 g piece, for 999, 916 and 750", () => {
    near(metalPerGram("999", USD_OZ, FX), 551.14);
    near(metalPerGram("916", USD_OZ, FX), 505.35);
    near(metalPerGram("750", USD_OZ, FX), 413.77);
    near(rawGoldValue(10, "999", USD_OZ, FX), 5511.4);
    near(rawGoldValue(10, "916", USD_OZ, FX), 5053.51);
    near(rawGoldValue(10, "750", USD_OZ, FX), 4137.7);
  });

  it("is hand-checkable at exactly 100 per gram: 10 g of 750 is 750", () => {
    expect(rawGoldValue(10, "750", 100 * GRAMS_PER_OUNCE, 1)).toBeCloseTo(750, 9);
  });

  it("pure gold is 551.69 and 999.9 uses 0.9999 (551.64)", () => {
    near(USD_OZ / GRAMS_PER_OUNCE * FX, 551.69);
    near(metalPerGram("999.9", USD_OZ, FX), 551.64);
  });
});

describe("buy check (spec section 3)", () => {
  const base = { weight: 10, purity: "916" as const, shopRate: 532.22, upah: 150, upahMode: "flat" as const, usdPerOz: USD_OZ, fxPerUsd: FX };

  it("example 3.1: a quoted total that adds up, the gold / upah split and the round-trip loss", () => {
    const r = buyCheck({ ...base, quotedTotal: 5472.2, buyBackRate: 497.22 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.goldPart).toBeCloseTo(5322.2, 9);
    expect(r.upahPart).toBe(150);
    expect(r.expectedTotal).toBeCloseTo(5472.2, 9);
    near(r.raw, 5053.51);
    near(r.shopMargin, 268.69);
    expect(r.shopMarginPct).toBeCloseTo(5.3, 1);
    near(r.paidOverRaw, 418.69);
    expect(r.upahShare).toBeCloseTo(0.0274, 3);
    expect(r.quote?.addsUp).toBe(true);
    expect(r.quote?.difference).toBeCloseTo(0, 9);
    expect(r.sellBack.basis).toBe("buyBack");
    expect(r.sellBack.payout).toBeCloseTo(4972.2, 9);
    expect(r.roundTripLoss).toBeCloseTo(500, 9); // upah 150 + 350 from the sell / buy-back gap
  });

  it("example 3.2: a quote RM 150 higher does not add up, by exactly 150", () => {
    const r = buyCheck({ ...base, quotedTotal: 5622.2 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.quote?.addsUp).toBe(false);
    expect(r.quote?.difference).toBeCloseTo(150, 9);
  });

  it("example 3.3: with no buy-back known the sell-back is a labelled estimate of metal value less 3%", () => {
    const r = buyCheck({ ...base, quotedTotal: 5472.2 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.sellBack.basis).toBe("estimate");
    near(r.sellBack.payout, 4901.91);
    near(r.roundTripLoss, 570.29);
  });

  it("example 3.4: the real rate per gram when a shop says 'no upah'", () => {
    const r = buyCheck({ ...base, quotedTotal: 5472.2 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.quote?.realRatePerGram).toBeCloseTo(532.22, 9);
  });

  it("uses the sell rate and a susut % when that is what the shopper knows", () => {
    const r = buyCheck({ ...base, susutPct: 7 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.sellBack.basis).toBe("susut");
    expect(r.sellBack.payout).toBeCloseTo(10 * 532.22 * 0.93, 9);
  });

  it("per-gram upah scales with the weight", () => {
    const r = buyCheck({ ...base, weight: 20, upah: 4, upahMode: "perGram" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.upahPart).toBe(80);
    expect(r.expectedTotal).toBeCloseTo(20 * 532.22 + 80, 9);
  });

  it("adds up within the whole-ringgit tolerance and not beyond it", () => {
    const within = buyCheck({ ...base, quotedTotal: 5472.2 + ADDS_UP_TOLERANCE });
    const beyond = buyCheck({ ...base, quotedTotal: 5472.2 + ADDS_UP_TOLERANCE + 0.01 });
    expect(within.ok && within.quote?.addsUp).toBe(true);
    expect(beyond.ok && beyond.quote?.addsUp).toBe(false);
  });

  it("rejects what cannot be calculated instead of guessing", () => {
    expect(buyCheck({ ...base, weight: 0 })).toEqual({ ok: false, error: "weight" });
    expect(buyCheck({ ...base, shopRate: 0 })).toEqual({ ok: false, error: "shopRate" });
    expect(buyCheck({ ...base, upah: -1 })).toEqual({ ok: false, error: "upah" });
    expect(buyCheck({ ...base, usdPerOz: 0 })).toEqual({ ok: false, error: "price" });
    expect(buyCheck({ ...base, fxPerUsd: Number.NaN })).toEqual({ ok: false, error: "price" });
  });
});

describe("sell / trade-in check (spec section 4)", () => {
  const base = { weight: 12.5, purity: "916" as const, usdPerOz: USD_OZ, fxPerUsd: FX };

  it("example 4.1: the shop's buy-back rate against its offer", () => {
    const r = sellCheck({ ...base, buyBackRate: 497.22, offer: 5900 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.estimate.basis).toBe("buyBack");
    expect(r.payout).toBeCloseTo(6215.25, 9);
    expect(r.offer?.difference).toBeCloseTo(-315.25, 9);
    expect(r.offer?.pct).toBeCloseTo(-5.07, 1);
  });

  it("example 4.2: a sell rate and susut 7% of that sell rate", () => {
    const r = sellCheck({ ...base, sellRate: 532.22, susutPct: 7, offer: 5900 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.estimate.basis).toBe("susut");
    expect(r.payout).toBeCloseTo(6187.06, 2);
    expect(r.offer?.difference).toBeCloseTo(-287.06, 2);
  });

  it("example 4.3: nothing known, an estimate of metal value less 3%", () => {
    const r = sellCheck({ ...base });
    if (!r.ok) throw new Error("expected ok");
    expect(r.estimate.basis).toBe("estimate");
    near(r.raw, 6316.89);
    near(r.payout, 6127.38);
  });

  it("example 4.4: trade-in credit against the cash payout", () => {
    const r = sellCheck({ ...base, buyBackRate: 485, tradeInRate: 490 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.tradeIn?.credit).toBeCloseTo(6125, 9);
    expect(r.tradeIn?.gain).toBeCloseTo(62.5, 9);
  });

  it("shows the other way of quoting: buy-back as a susut %, and susut as a buy-back rate", () => {
    const a = estimateSell({ weight: 1, rawValue: 500, buyBackRate: 497.22, sellRate: 532.22 });
    expect(a.susutPct).toBeCloseTo(6.58, 2);
    const b = estimateSell({ weight: 1, rawValue: 500, sellRate: 532.22, susutPct: 7 });
    expect(b.buyBackRate).toBeCloseTo(532.22 * 0.93, 9);
  });

  it("route 1 wins over route 2, and upah never enters any route", () => {
    const e = estimateSell({ weight: 10, rawValue: 5000, buyBackRate: 490, sellRate: 532.22, susutPct: 7 });
    expect(e.basis).toBe("buyBack");
    expect(e.payout).toBe(4900);
  });

  it("never pays a negative amount and does not divide by a zero payout", () => {
    const r = sellCheck({ ...base, buyBackRate: 100, fee: 1_000_000, offer: 500 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.payout).toBe(0);
    expect(r.offer?.pct).toBeNull();
  });

  it("ignores an unusable susut (negative, or 100% and over) and falls back to the estimate", () => {
    expect(estimateSell({ weight: 1, rawValue: 100, sellRate: 50, susutPct: -5 }).basis).toBe("estimate");
    expect(estimateSell({ weight: 1, rawValue: 100, sellRate: 50, susutPct: 100 }).basis).toBe("estimate");
    expect(estimateSell({ weight: 1, rawValue: 100, sellRate: 50, susutPct: 0 }).basis).toBe("susut"); // an explicit 0% is real
  });

  it("rejects an empty weight or price", () => {
    expect(sellCheck({ ...base, weight: 0 })).toEqual({ ok: false, error: "weight" });
    expect(sellCheck({ ...base, usdPerOz: 0 })).toEqual({ ok: false, error: "price" });
  });
});

describe("buy here / sell here (spec section 5)", () => {
  const q = (name: string, sellRate: number, upah: number, buyBackRate = 0) => ({ name, sellRate, upah, upahMode: "flat" as const, buyBackRate });

  it("example 5.1: lowest total, highest payout and each shop's round-trip loss", () => {
    const r = compareQuotes(10, [q("A", 522.3, 0, 494.75), q("B", 532.22, 150, 497.22), q("C", 565, 0, 491)]);
    if (!r.ok) throw new Error("expected ok");
    expect(r.rows.map((x) => Number(x.total.toFixed(2)))).toEqual([5223, 5472.2, 5650]);
    expect(r.rows.map((x) => Number(x.payout!.toFixed(2)))).toEqual([4947.5, 4972.2, 4910]);
    expect(r.rows.map((x) => Number(x.roundTripLoss!.toFixed(2)))).toEqual([275.5, 500, 740]);
    expect(r.buyHere).toEqual([0]); // A is cheapest to buy
    expect(r.sellHere).toEqual([1]); // B pays the most, which is NOT the most expensive place to buy (C)
  });

  it("never guesses a payout for a shop that gave no buy-back rate", () => {
    const r = compareQuotes(10, [q("A", 500, 0), q("B", 520, 0, 480)]);
    if (!r.ok) throw new Error("expected ok");
    expect(r.rows[0]!.payout).toBeNull();
    expect(r.rows[0]!.roundTripLoss).toBeNull();
    expect(r.sellHere).toEqual([1]);
  });

  it("no buy-back anywhere means no 'sell here'", () => {
    const r = compareQuotes(10, [q("A", 500, 0), q("B", 520, 0)]);
    if (!r.ok) throw new Error("expected ok");
    expect(r.sellHere).toEqual([]);
  });

  it("shows ties as ties", () => {
    const r = compareQuotes(10, [q("A", 500, 0, 480), q("B", 500, 0, 480)]);
    if (!r.ok) throw new Error("expected ok");
    expect(r.buyHere).toEqual([0, 1]);
    expect(r.sellHere).toEqual([0, 1]);
  });

  it("leaves blank rows out and keeps the index of the rest", () => {
    const r = compareQuotes(10, [q("", 0, 0), q("B", 520, 0)]);
    if (!r.ok) throw new Error("expected ok");
    expect(r.rows).toHaveLength(1);
    expect(r.buyHere).toEqual([1]);
  });

  it("asks for at least one usable quote and a weight", () => {
    expect(compareQuotes(10, [q("", 0, 0)])).toEqual({ ok: false, error: "quotes" });
    expect(compareQuotes(0, [q("A", 500, 0)])).toEqual({ ok: false, error: "weight" });
  });
});

describe("my gold shares the engine (spec section 6)", () => {
  it("example 6.1: value now, estimated sell and profit or loss against RM 5,472.20", () => {
    const v = pieceValue({ weight: 10, purity: "916", usdPerOz: USD_OZ, fxPerUsd: FX });
    near(v.valueNow, 5053.51);
    near(v.estimatedSell, 4901.91);
    near(v.estimatedSell - 5472.2, -570.29);
  });

  it("one piece gives the same value and estimate on Buy check, Sell check and My gold", () => {
    const buy = buyCheck({ weight: 10, purity: "916", shopRate: 532.22, upah: 150, upahMode: "flat", usdPerOz: USD_OZ, fxPerUsd: FX });
    const sell = sellCheck({ weight: 10, purity: "916", usdPerOz: USD_OZ, fxPerUsd: FX });
    const mine = pieceValue({ weight: 10, purity: "916", usdPerOz: USD_OZ, fxPerUsd: FX });
    if (!buy.ok || !sell.ok) throw new Error("expected ok");
    expect(buy.raw).toBe(mine.valueNow);
    expect(sell.raw).toBe(mine.valueNow);
    expect(buy.sellBack.payout).toBe(mine.estimatedSell);
    expect(sell.payout).toBe(mine.estimatedSell);
  });
});

describe("country estimate (spec section 7)", () => {
  it("example 7.1: 10 g 916 in Singapore with a 5% margin, S$ 30 upah and 9% GST", () => {
    const sg: Country = { id: "sg", name: "Singapore", currency: "SGD", rate: 1.2784, duty: 0, tax: 9 };
    const e = countryEstimate({ weight: 10, purity: "916", country: sg, usdPerOz: USD_OZ, upahUsd: 30 / 1.2784 });
    expect(e.metalUsd * 1.2784).toBeCloseTo(1576.36, 1);
    expect((e.metalUsd + e.marginUsd) * 1.2784).toBeCloseTo(1655.18, 1);
    expect(e.totalLocal).toBeCloseTo(1836.85, 1);
    expect(e.taxUsd * 1.2784).toBeCloseTo(151.67, 1);
  });

  it("example 7.2: 10 g 916 in India with 5% margin, 15% import duty, upah 2,000 and 3% GST", () => {
    const inr: Country = { id: "in", name: "India", currency: "INR", rate: 88, duty: 15, tax: 3 };
    const e = countryEstimate({ weight: 10, purity: "916", country: inr, usdPerOz: USD_OZ, upahUsd: 2000 / 88 });
    expect(e.metalUsd * 88).toBeCloseTo(108510.6, 1);
    expect((e.metalUsd + e.marginUsd) * 88).toBeCloseTo(113936.13, 1);
    expect(e.dutyUsd * 88).toBeCloseTo(17090.42, 1);
    expect(e.totalLocal).toBeCloseTo(137017.35, 1);
    expect(e.taxUsd * 88).toBeCloseTo(3990.8, 1);
  });

  it("India's shipped duty is 15% everywhere it is defined", () => {
    const catalog = COUNTRY_CATALOG.find((c) => c.name === "India");
    const preset = gold.DEFAULT_COUNTRIES.find((c) => c.id === "in");
    expect(catalog?.duty).toBe(15);
    expect(preset?.duty).toBe(15);
    expect(catalog?.tax).toBe(3);
  });

  it("duty applies to the metal and its margin, never to upah", () => {
    const c: Country = { id: "x", name: "X", currency: "XXX", rate: 1, duty: 10, tax: 0 };
    const noUpah = countryEstimate({ weight: 10, purity: "999.9", country: c, usdPerOz: 100 * GRAMS_PER_OUNCE, basis: "raw" });
    const withUpah = countryEstimate({ weight: 10, purity: "999.9", country: c, usdPerOz: 100 * GRAMS_PER_OUNCE, basis: "raw", upahUsd: 50 });
    expect(withUpah.dutyUsd).toBeCloseTo(noUpah.dutyUsd, 9);
    expect(withUpah.totalUsd - noUpah.totalUsd).toBeCloseTo(50, 9);
  });

  it("premium falls back to the single labelled 5% assumption", () => {
    const c: Country = { id: "x", name: "X", currency: "XXX", rate: 1, duty: 0, tax: 0 };
    expect(premiumOf(c, "retail")).toBe(5);
    expect(premiumOf(c, "raw")).toBe(0);
    expect(premiumOf({ ...c, premium: 6 }, "retail")).toBe(6);
  });

  it("landedPerGram multiplies fineness, margin, duty and tax (the per-gram view)", () => {
    const c: Country = { id: "x", name: "X", currency: "XXX", rate: 1, duty: 6, tax: 3, premium: 6 };
    expect(landedPerGram(c, 100 * GRAMS_PER_OUNCE, "retail", 0.75)).toBeCloseTo(100 * 0.75 * 1.06 * 1.06 * 1.03, 9);
  });
});

describe("exchange rate from the snapshot (L1)", () => {
  const myr = { currency: "MYR", rate: 4.45 };

  it("an untouched shipped rate follows the market rate", () => {
    expect(effectiveRate(myr, { MYR: 4.0845 })).toBe(4.0845);
    expect(effectiveRate({ currency: "MYR", rate: 4.1 }, { MYR: 4.0845 })).toBe(4.0845);
  });

  it("a rate the person set is kept", () => {
    expect(effectiveRate({ currency: "MYR", rate: 4.3 }, { MYR: 4.0845 })).toBe(4.3);
  });

  it("without a market rate the stored one is used", () => {
    expect(effectiveRate(myr, null)).toBe(4.45);
    expect(effectiveRate({ currency: "XYZ", rate: 9 }, { MYR: 4.08 })).toBe(9);
  });

  it("every default this app ships is in the 'untouched' table, so none is mistaken for a user's edit", () => {
    const shipped = [...DEFAULT_COUNTRIES, ...COUNTRY_CATALOG.map((c) => ({ currency: c.currency, rate: c.rate }))];
    for (const c of shipped) {
      if (c.currency in SHIPPED_RATES) expect(SHIPPED_RATES[c.currency]).toContain(c.rate);
    }
  });

  it("a saved margin that is one of the retired shipped defaults falls back to the single 5% assumption; a changed one is kept", () => {
    const my = { id: "my", name: "Malaysia", currency: "MYR", rate: 4.45, duty: 0, tax: 0 };
    expect(effectiveCountry({ ...my, premium: 6 }, { MYR: 4.0845 }).premium).toBeUndefined();
    expect(effectiveCountry({ ...my, premium: 6 }, { MYR: 4.0845 }).rate).toBe(4.0845);
    expect(effectiveCountry({ ...my, premium: 8 }, null).premium).toBe(8);
    expect(effectiveCountry(my, null)).toEqual(my);
  });

  it("a saved India duty of the retired 6% becomes 15%; one the person changed is kept; other countries are untouched", () => {
    const india = { id: "in", name: "India", currency: "INR", rate: 96, duty: 6, tax: 3 };
    expect(effectiveCountry(india, null).duty).toBe(15);
    expect(effectiveCountry({ ...india, duty: 12 }, null).duty).toBe(12);
    expect(effectiveCountry({ ...india, duty: 15 }, null).duty).toBe(15);
    // an India added from the catalog under another id is covered too (the key is the currency)
    expect(effectiveCountry({ ...india, id: "c-123" }, null).duty).toBe(15);
    // a different country that happens to carry 6% is not India's
    expect(effectiveCountry({ id: "x", name: "X", currency: "XXX", rate: 1, duty: 6, tax: 0 }, null).duty).toBe(6);
  });

  it("the display currency defaults to ringgit", () => {
    expect(DEFAULT_SETTINGS.baseCurrency).toBe("MYR");
    expect(DEFAULT_TRADE.currency).toBe("MYR");
  });
});

describe("the price paid stays what was paid (L8)", () => {
  const rates: Record<string, number> = { USD: 1, MYR: 4.0845, SGD: 1.2784 };
  const rateOf = (c: string) => rates[c] ?? null;

  it("in the currency it was paid in, the amount is exactly what was typed, whatever the exchange rate does", () => {
    const item = { paid: 5000, currency: "MYR", paidUsd: 1123.6 };
    expect(paidInDisplay(item, "MYR", 4.0845, rateOf)).toEqual({ amount: 5000, exact: true });
    expect(paidInDisplay(item, "MYR", 3.9, rateOf)).toEqual({ amount: 5000, exact: true }); // the rate moved: still RM 5,000
  });

  it("in another currency it is converted at today's rate and marked as not exact", () => {
    const r = paidInDisplay({ paid: 5000, currency: "MYR", paidUsd: 1123.6 }, "SGD", 1.2784, rateOf);
    expect(r.exact).toBe(false);
    expect(r.amount).toBeCloseTo((5000 / 4.0845) * 1.2784, 6);
  });

  it("a piece saved before this change falls back to its USD figure, and so does one whose currency has no known rate", () => {
    expect(paidInDisplay({ paidUsd: 1000 }, "MYR", 4, rateOf)).toEqual({ amount: 4000, exact: false });
    expect(paidInDisplay({ paid: 900, currency: "XYZ", paidUsd: 1000 }, "MYR", 4, rateOf)).toEqual({ amount: 4000, exact: false });
  });

  it("migration: RM 5,000 typed at the saved rate 4.45 comes back as RM 5,000, not as RM 4,584 at the market rate", () => {
    const old = { id: "a", name: "x", weight: 10, purity: "916" as const, paidUsd: 5000 / 4.45, date: "2026-10-01" };
    const m = migrateVaultPaid([old], { currency: "MYR", ratePerUsd: 4.45, now: new Date("2026-10-14T00:00:00Z") });
    expect(m.changed).toBe(1);
    expect(m.vault[0]).toMatchObject({ paid: 5000, currency: "MYR", updatedAt: "2026-10-14T00:00:00.000Z" });
    expect(paidInDisplay(m.vault[0]!, "MYR", 4.0845, rateOf).amount).toBe(5000);
  });

  it("migration leaves pieces that already have their price alone, returns the same array when nothing changes, and is safe without a rate", () => {
    const done = { id: "a", name: "x", weight: 10, purity: "916" as const, paidUsd: 100, paid: 450, currency: "MYR", date: "2026-10-01", updatedAt: "2026-10-02T00:00:00.000Z" };
    const vault = [done];
    const m = migrateVaultPaid(vault, { currency: "MYR", ratePerUsd: 4.45, now: new Date() });
    expect(m.vault).toBe(vault);
    expect(m.changed).toBe(0);
    const legacy = [{ ...done, paid: undefined, currency: undefined }];
    expect(migrateVaultPaid(legacy as never, { currency: "MYR", ratePerUsd: 0, now: new Date() }).changed).toBe(0);
    expect(migrateVaultPaid(legacy as never, { currency: "ringgit", ratePerUsd: 4, now: new Date() }).changed).toBe(0);
  });

  it("migrating in USD keeps the USD figure as what was paid", () => {
    const m = migrateVaultPaid([{ id: "a", name: "x", weight: 1, purity: "916", paidUsd: 1234.56, date: "2026-10-01" }], { currency: "USD", ratePerUsd: 1, now: new Date() });
    expect(m.vault[0]).toMatchObject({ paid: 1234.56, currency: "USD" });
  });

  it("currencyRate: USD is 1, a watchlist currency its rate, the display currency its manual rate, anything else unknown", () => {
    const s = { ...DEFAULT_SETTINGS, baseCurrency: "EUR", baseRate: 0.92 };
    expect(currencyRate("USD", s, [])).toBe(1);
    expect(currencyRate("MYR", s, DEFAULT_COUNTRIES)).toBe(DEFAULT_COUNTRIES[0]!.rate);
    expect(currencyRate("EUR", s, [])).toBe(0.92);
    expect(currencyRate("GBP", s, [])).toBeNull();
  });
});

describe("typed amounts when the display currency changes", () => {
  it("restates every money field at the new rate and leaves weights alone", () => {
    const t = { ...DEFAULT_TRADE, weight: 12.5, buy: { ...DEFAULT_TRADE.buy, shopRate: 532.22, upah: 150, quotedTotal: 5472.2 } };
    const usd = convertTradeMoney(t, 4.0983, 1, "USD");
    expect(usd.currency).toBe("USD");
    expect(usd.weight).toBe(12.5);
    expect(usd.buy.shopRate).toBeCloseTo(129.86, 2);
    expect(usd.buy.upah).toBeCloseTo(36.6, 1);
    expect(usd.sell.offer).toBe(0); // blank stays blank
  });

  it("clears the money when the old rate cannot be known, keeping weight and purity", () => {
    const t = { ...DEFAULT_TRADE, weight: 7, purity: "750" as const, buy: { ...DEFAULT_TRADE.buy, shopRate: 400 } };
    const c = clearTradeMoney(t, "EUR");
    expect(c.buy.shopRate).toBe(0);
    expect(c.weight).toBe(7);
    expect(c.purity).toBe("750");
    expect(c.currency).toBe("EUR");
  });

  it("rateKnown: USD, watchlist currencies and the manual rate of the display currency", () => {
    const s = { ...DEFAULT_SETTINGS, baseCurrency: "EUR", baseRate: 0.92 };
    expect(rateKnown("USD", s, [])).toBe(true);
    expect(rateKnown("MYR", s, DEFAULT_COUNTRIES)).toBe(true);
    expect(rateKnown("EUR", s, [])).toBe(true);
    expect(rateKnown("GBP", s, [])).toBe(false);
  });
});

describe("currency, purity and settings helpers", () => {
  const country: Country = { id: "x", name: "Testland", currency: "TST", rate: 4.45, duty: 6, tax: 3, premium: 6 };

  it("baseRateOf: USD is 1, a watchlist currency uses its rate, otherwise the manual rate, otherwise 1", () => {
    const list = [country];
    expect(baseRateOf({ ...DEFAULT_SETTINGS, baseCurrency: "USD" }, list)).toBe(1);
    expect(baseRateOf({ ...DEFAULT_SETTINGS, baseCurrency: "TST" }, list)).toBe(4.45);
    expect(baseRateOf({ ...DEFAULT_SETTINGS, baseCurrency: "EUR", baseRate: 0.92 }, list)).toBe(0.92);
    expect(baseRateOf({ ...DEFAULT_SETTINGS, baseCurrency: "EUR", baseRate: 0 }, list)).toBe(1);
  });

  it("parsePurity accepts stamps and legacy karat labels and REJECTS anything else", () => {
    expect(parsePurity("916")).toBe("916");
    expect(parsePurity("22K")).toBe("916");
    expect(parsePurity("9K")).toBe("375");
    expect(parsePurity("375")).toBe("375");
    expect(parsePurity("not-a-purity")).toBeNull();
    expect(parsePurity("")).toBeNull();
    expect(parsePurity(916)).toBe("916"); // typed as a number, as spreadsheets and some exports write it
    expect(parsePurity(" 750 ")).toBe("750");
    expect(parsePurity("22k")).toBe("916");
    expect(parsePurity(undefined)).toBeNull();
  });

  it("normPurity maps legacy karat codes and keeps known stamps", () => {
    expect(normPurity("22K")).toBe("916");
    expect(normPurity("24K")).toBe("999.9");
    expect(normPurity("18K")).toBe("750");
    expect(normPurity("916")).toBe("916");
    expect(fineOf("916")).toBeCloseTo(0.916, 12);
    expect(fineOf("375")).toBeCloseTo(0.375, 12);
    expect(karatOf("750")).toBe(18);
    expect(purityLabel("22K")).toContain("916");
  });

  it("normPurity is the forgiving form: an unknown code becomes 916, so outside data goes through parsePurity", () => {
    expect(normPurity("not-a-purity")).toBe("916");
  });

  it("fmt formats money, shows a dash for non-finite values and survives a bad currency code", () => {
    expect(fmt(1234.5, "USD", 2)).toBe("$1,234.50");
    expect(fmt(Number.NaN)).toBe("—");
    expect(fmt(Number.POSITIVE_INFINITY)).toBe("—");
    expect(fmt(1.5, "ZZZZ", 2)).toBe("1.50 ZZZZ");
  });

  it("fmt writes ringgit as RM, not MYR", () => {
    expect(fmt(5053.51, "MYR", 2)).toMatch(/^RM\s?5,053\.51$/);
  });

  it("hasDefaultSpot is true only while the user has never set a price", () => {
    expect(hasDefaultSpot(DEFAULT_SETTINGS)).toBe(true);
    expect(hasDefaultSpot({ ...DEFAULT_SETTINGS, spotUsdOz: 4000 })).toBe(false);
    expect(hasDefaultSpot({ ...DEFAULT_SETTINGS, updatedAt: "2026-10-07T00:00:00Z" })).toBe(false);
    expect(hasDefaultSpot({ ...DEFAULT_SETTINGS, source: "live" })).toBe(false);
    expect(hasDefaultSpot({ ...DEFAULT_SETTINGS, source: "market" })).toBe(false);
  });
});

describe("what the engine no longer does", () => {
  it("the made-up price trend generator is gone and must not come back", () => {
    expect("spotSeries" in gold).toBe(false);
  });

  it("the old verdict, 'analyze' and 5% susut-on-metal helpers are gone", () => {
    for (const name of ["verdictOf", "analyze", "sellQuote", "cheapestOf"]) expect(name in gold).toBe(false);
  });

  it("the first-visit live-price pop-up and its rule are gone (the key stays an option in Settings)", () => {
    expect("shouldPromptForLiveKey" in gold).toBe(false);
  });
});
