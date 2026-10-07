import { describe, expect, it } from "vitest";
import * as gold from "./gold";
import {
  DEFAULT_SETTINGS,
  GRAMS_PER_OUNCE,
  analyze,
  baseRateOf,
  cheapestOf,
  fineOf,
  fmt,
  hasDefaultSpot,
  karatOf,
  landedPerGram,
  normPurity,
  premiumOf,
  shouldPromptForLiveKey,
  purityLabel,
  sellQuote,
  verdictOf,
  type Country,
  type Trade,
} from "./gold";

/**
 * The expected numbers below are worked out by hand, not copied from the code's output.
 * Trick: spot = 100 USD per GRAM exactly (3110.34768 USD/oz), so every figure can be checked on paper.
 *   10 g of 750 gold  -> 7.5 g pure -> 750 USD of metal.
 */
const SPOT = 100 * GRAMS_PER_OUNCE;

const country: Country = {
  id: "x",
  name: "Testland",
  currency: "TST",
  rate: 4.45,
  duty: 6,
  tax: 3,
  premium: 6,
};
const trade: Trade = {
  weight: 10,
  purity: "750",
  feeMode: "perGram",
  fee: 4, // 4 per gram x 10 g = 40
  melting: 0,
  askingPrice: 0,
  countryId: "x",
};

describe("analyze (what buying costs)", () => {
  it("raw basis: metal + making fee, then duty, then tax", () => {
    const r = analyze(trade, country, SPOT, "raw");
    expect(r.spotG).toBeCloseTo(100, 9);
    expect(r.pureGrams).toBeCloseTo(7.5, 12); // 10 g x 0.750
    expect(r.netGold).toBeCloseTo(750, 9);
    expect(r.makingFee).toBeCloseTo(40, 12);
    expect(r.shopMarkup).toBe(0); // no shop mark-up on the raw basis
    // (750 + 40) = 790 ; x1.06 duty = 837.4 ; x1.03 tax = 862.522
    expect(r.totalUsd).toBeCloseTo(862.522, 9);
    expect(r.duties).toBeCloseTo(47.4, 9);
    expect(r.taxes).toBeCloseTo(25.122, 9);
    expect(r.totalLocal).toBeCloseTo(862.522 * 4.45, 9);
  });

  it("premium % and break-even are measured against the metal value", () => {
    const r = analyze(trade, country, SPOT, "raw");
    expect(r.premiumPct).toBeCloseTo(((862.522 - 750) / 750) * 100, 9); // 15.00293...
    expect(r.breakEvenPerG).toBeCloseTo(86.2522, 9); // per gram of the piece
    expect(r.breakEvenPerPureG).toBeCloseTo(862.522 / 7.5, 9); // per gram of pure gold
  });

  it("retail basis adds the shop mark-up on the metal, before duty and tax", () => {
    const r = analyze(trade, country, SPOT, "retail");
    expect(r.shopMarkup).toBeCloseTo(45, 9); // 6% of 750
    // (750 + 45 + 40) = 835 ; x1.06 = 885.1 ; x1.03 = 911.653
    expect(r.totalUsd).toBeCloseTo(911.653, 9);
  });

  it("melting cost is NEVER part of a purchase (it only applies when selling)", () => {
    const withMelting = analyze({ ...trade, melting: 99 }, country, SPOT, "raw");
    expect(withMelting.totalUsd).toBeCloseTo(862.522, 9);
  });

  it("flat vs per-gram making fee diverge as the weight changes", () => {
    const flat = analyze(
      { ...trade, weight: 20, feeMode: "flat", fee: 40 },
      { ...country, duty: 0, tax: 0 },
      SPOT,
      "raw",
    );
    const perGram = analyze(
      { ...trade, weight: 20, feeMode: "perGram", fee: 4 },
      { ...country, duty: 0, tax: 0 },
      SPOT,
      "raw",
    );
    expect(flat.makingFee).toBe(40);
    expect(perGram.makingFee).toBe(80);
    expect(flat.totalUsd).toBeCloseTo(1500 + 40, 9); // 20 g x 0.75 = 15 g pure = 1500
    expect(perGram.totalUsd).toBeCloseTo(1500 + 80, 9);
  });

  it("compares the seller's asking price with the metal value", () => {
    expect(analyze({ ...trade, askingPrice: 900 }, country, SPOT).askingPremium).toBeCloseTo(20, 9); // (900-750)/750
    expect(analyze(trade, country, SPOT).askingPremium).toBeNull(); // nothing asked
  });

  it("does not divide by zero for empty or zero-weight trades", () => {
    const r = analyze({ ...trade, weight: 0 }, country, SPOT, "raw");
    expect(r.premiumPct).toBe(0);
    expect(r.breakEvenPerG).toBe(0);
    expect(r.breakEvenPerPureG).toBe(0);
  });
});

describe("sellQuote (what selling pays)", () => {
  it("takes the default 5% deduction (susut) and the melting cost off the metal value", () => {
    const q = sellQuote({ ...trade, melting: 20 }, SPOT);
    expect(q.metal).toBeCloseTo(750, 9);
    expect(q.deductionUsd).toBeCloseTo(37.5, 9); // 5% of 750
    expect(q.payout).toBeCloseTo(692.5, 9); // 750 - 37.5 - 20
  });

  it("uses an explicit deduction, including an explicit 0%", () => {
    expect(sellQuote({ ...trade, deduction: 10, melting: 20 }, SPOT).payout).toBeCloseTo(655, 9); // 750 - 75 - 20
    expect(sellQuote({ ...trade, deduction: 0 }, SPOT).payout).toBeCloseTo(750, 9); // 0 is not "unset"
  });

  it("never pays out a negative amount", () => {
    expect(sellQuote({ ...trade, melting: 10_000 }, SPOT).payout).toBe(0);
  });
});

describe("verdictOf (is the asking price fair?)", () => {
  it.each([
    [95, "good", "below the fair cost"],
    [100, "good", "exactly the fair cost"],
    [105, "fair", "5% over is still fair (inclusive)"],
    [105.01, "pricey", "just past 5%"],
    [115, "pricey", "15% over is still pricey (inclusive)"],
    [115.01, "expensive", "just past 15%"],
  ] as const)("asking %s against a fair cost of 100 -> %s (%s)", (asking, tone, _why) => {
    expect(verdictOf(asking, 100)?.tone).toBe(tone);
  });

  it("gives no verdict without a usable asking price or cost", () => {
    expect(verdictOf(0, 100)).toBeNull();
    expect(verdictOf(-5, 100)).toBeNull();
    expect(verdictOf(100, 0)).toBeNull();
  });
});

describe("landedPerGram, cheapestOf and mark-up rules", () => {
  it("landedPerGram multiplies fineness, shop mark-up, duty and tax", () => {
    expect(landedPerGram(country, SPOT, "retail", 0.75)).toBeCloseTo(
      100 * 0.75 * 1.06 * 1.06 * 1.03,
      9,
    ); // 86.7981
    expect(landedPerGram(country, SPOT, "raw", 0.75)).toBeCloseTo(100 * 0.75 * 1.06 * 1.03, 9); // 81.885
  });

  it("premiumOf applies only on the retail basis and falls back to 5% when unset", () => {
    expect(premiumOf(country, "raw")).toBe(0);
    expect(premiumOf(country, "retail")).toBe(6);
    const { premium: _unset, ...noPremium } = country;
    expect(premiumOf(noPremium, "retail")).toBe(5);
  });

  it("cheapestOf picks the lowest all-in cost, and null for an empty list", () => {
    const a = { ...country, id: "a", duty: 10 };
    const b = { ...country, id: "b", duty: 0 };
    const c = { ...country, id: "c", duty: 5 };
    expect(cheapestOf([a, b, c], trade, SPOT, "raw")?.c.id).toBe("b");
    expect(cheapestOf([], trade, SPOT, "raw")).toBeNull();
  });
});

describe("currency, purity and settings helpers", () => {
  it("baseRateOf: USD is 1, a watchlist currency uses its rate, otherwise the manual rate, otherwise 1", () => {
    const list = [country];
    expect(baseRateOf({ ...DEFAULT_SETTINGS, baseCurrency: "USD" }, list)).toBe(1);
    expect(baseRateOf({ ...DEFAULT_SETTINGS, baseCurrency: "TST" }, list)).toBe(4.45);
    expect(baseRateOf({ ...DEFAULT_SETTINGS, baseCurrency: "EUR", baseRate: 0.92 }, list)).toBe(
      0.92,
    );
    expect(baseRateOf({ ...DEFAULT_SETTINGS, baseCurrency: "EUR", baseRate: 0 }, list)).toBe(1);
  });

  it("normPurity maps legacy karat codes and keeps known stamps", () => {
    expect(normPurity("22K")).toBe("916");
    expect(normPurity("24K")).toBe("999.9");
    expect(normPurity("18K")).toBe("750");
    expect(normPurity("916")).toBe("916");
    expect(fineOf("916")).toBeCloseTo(0.916, 12);
    expect(karatOf("750")).toBe(18);
    expect(purityLabel("22K")).toContain("916");
  });

  it("normPurity silently turns an UNKNOWN code into 916 - callers must validate first (see the Vault import)", () => {
    expect(normPurity("not-a-purity")).toBe("916");
  });

  it("fmt formats money, shows a dash for non-finite values and survives a bad currency code", () => {
    expect(fmt(1234.5, "USD", 2)).toBe("$1,234.50");
    expect(fmt(Number.NaN)).toBe("—");
    expect(fmt(Number.POSITIVE_INFINITY)).toBe("—");
    expect(fmt(1.5, "ZZZZ", 2)).toBe("1.50 ZZZZ");
  });

  it("hasDefaultSpot is true only while the user has never set a price", () => {
    expect(hasDefaultSpot(DEFAULT_SETTINGS)).toBe(true);
    expect(hasDefaultSpot({ ...DEFAULT_SETTINGS, spotUsdOz: 4000 })).toBe(false);
    expect(hasDefaultSpot({ ...DEFAULT_SETTINGS, updatedAt: "2026-10-07T00:00:00Z" })).toBe(false);
    expect(hasDefaultSpot({ ...DEFAULT_SETTINGS, source: "live" })).toBe(false);
    expect(hasDefaultSpot({ ...DEFAULT_SETTINGS, source: "market" })).toBe(false);
  });
});

describe("shouldPromptForLiveKey (the one-time 'want a live price?' pop-up)", () => {
  const typed = {
    ...DEFAULT_SETTINGS,
    source: "manual" as const,
    updatedAt: "2026-10-07T00:00:00Z",
    spotUsdOz: 4000,
  };

  it("shows for a brand-new visitor on the default price", () => {
    expect(shouldPromptForLiveKey(DEFAULT_SETTINGS)).toBe(true);
  });

  it("shows for someone following the latest daily close", () => {
    expect(
      shouldPromptForLiveKey({
        ...DEFAULT_SETTINGS,
        source: "market",
        updatedAt: "x",
        spotUsdOz: 4165.7,
      }),
    ).toBe(true);
  });

  it("shows only once: never again after it was answered or closed", () => {
    expect(shouldPromptForLiveKey({ ...DEFAULT_SETTINGS, livePromptSeen: true })).toBe(false);
  });

  it("never for someone who already has a key, or already uses a live price", () => {
    expect(shouldPromptForLiveKey({ ...DEFAULT_SETTINGS, apiKey: "goldapi-abc" })).toBe(false);
    expect(shouldPromptForLiveKey({ ...DEFAULT_SETTINGS, source: "live", updatedAt: "x" })).toBe(
      false,
    );
    expect(shouldPromptForLiveKey({ ...DEFAULT_SETTINGS, apiKey: "   " })).toBe(true); // whitespace is not a key
  });

  it("never for someone who typed their own price", () => {
    expect(shouldPromptForLiveKey(typed)).toBe(false);
  });
});

describe("no invented data", () => {
  it("the made-up price trend generator is gone and must not come back", () => {
    expect("spotSeries" in gold).toBe(false);
  });
});
