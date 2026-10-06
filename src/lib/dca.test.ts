import { describe, expect, it } from "vitest";
import { backtestDca, type DcaHistory, type DcaParams, type DcaResult } from "./dca";
import { GRAMS_PER_OUNCE, analyze, type Country } from "./gold";

/**
 * Hand-worked scenario. The gold price (USD per oz) is chosen so that the price per GRAM is exactly 100 x m:
 *
 *   date        m     per gram   USD/MYR
 *   2026-01-02  0.5   (partial first month: never used)
 *   2026-01-15  0.6
 *   2026-02-02  0.8
 *   2026-03-02  0.9
 *   2026-04-01  1.0   100        4        <- purchase 1 (first trading day of April)
 *   2026-04-15  1.2
 *   2026-05-04  2.0   200        5        <- purchase 2 (May 1 was a holiday)
 *   2026-05-20  2.5
 *   2026-06-01  4.0   400        5        <- purchase 3
 *   2026-06-15  4.0   400        5        <- last day of data
 *
 * With purity 750 (0.75 fine) and no shop mark-up, a gram of the piece costs 75, 150, 300 on the three purchase days.
 */
const rows: [string, number, number][] = [
  ["2026-01-02", 0.5, 4],
  ["2026-01-15", 0.6, 4],
  ["2026-02-02", 0.8, 4],
  ["2026-03-02", 0.9, 4],
  ["2026-04-01", 1.0, 4],
  ["2026-04-15", 1.2, 4],
  ["2026-05-04", 2.0, 5],
  ["2026-05-20", 2.5, 5],
  ["2026-06-01", 4.0, 5],
  ["2026-06-15", 4.0, 5],
];
const build = (r: [string, number, number][]): DcaHistory => ({
  dates: r.map((x) => x[0]),
  xau: r.map((x) => 100 * GRAMS_PER_OUNCE * x[1]),
  usdmyr: r.map((x) => x[2]),
});
const history = build(rows);

const flat: Country = {
  id: "t",
  name: "Flat",
  currency: "USD",
  rate: 1,
  duty: 0,
  tax: 0,
  premium: 0,
};
const base: DcaParams = {
  months: 3,
  contribution: { mode: "grams", grams: 2 },
  purity: "750",
  country: flat,
  basis: "raw",
  savingsRatePct: 12, // 1% a month
  baseCurrency: "USD",
  baseRateToday: 1,
  deductionPct: 5,
};
const run = (over: Partial<DcaParams> = {}, h: DcaHistory = history): DcaResult => {
  const r = backtestDca(h, { ...base, ...over });
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r;
};
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe("buying 2 g of 750 every month for 3 months (USD, raw prices)", () => {
  const r = run();

  it("buys on the first trading day of each month", () => {
    expect(r.purchases.map((p) => p.date)).toEqual(["2026-04-01", "2026-05-04", "2026-06-01"]);
    expect(r.purchaseCount).toBe(3);
    expect(r.clamped).toBe(false);
  });

  it("pays 75, 150 and 300 USD per gram, so 150 + 300 + 600 in total", () => {
    r.purchases.forEach((p, i) => close(p.costUsd, [150, 300, 600][i]!));
    close(r.investedBase, 1050);
    close(r.totalGrams, 6);
    close(r.totalPureGrams, 4.5); // 6 g x 0.75
    close(r.avgCostPerGramBase, 175); // 1050 / 6
    close(r.avgCostPerPureGramBase, 1050 / 4.5);
  });

  it("values the gold at the last price (400 per gram): 4.5 pure grams = 1800", () => {
    close(r.valueAtSpotBase, 1800);
    close(r.profitAtSpotBase, 750);
    close(r.valueSellBackBase, 1800); // raw basis: no susut
  });

  it("compounds the same cash at 1% a month: 150 x 1.01^2 + 300 x 1.01 + 600", () => {
    close(r.savingsBase, 150 * 1.01 ** 2 + 300 * 1.01 + 600); // 1056.015
    close(r.goldVsSavingsBase, 1800 - 1056.015);
  });

  it("returns a series for the chart: one point per purchase plus the final day", () => {
    expect(r.series.map((s) => s.date)).toEqual([
      "2026-04-01",
      "2026-05-04",
      "2026-06-01",
      "2026-06-15",
    ]);
    close(r.series[0]!.invested, 150);
    close(r.series[0]!.goldValue, 150); // 2 g x 0.75 x 100
    close(r.series[1]!.invested, 450);
    close(r.series[1]!.goldValue, 600); // 3 pure g x 200
    close(r.series[1]!.savings, 150 * 1.01 + 300);
    close(r.series[3]!.goldValue, 1800);
    close(r.series[3]!.savings, 1056.015);
    r.series.forEach(
      (s, i) => i && expect(s.invested).toBeGreaterThanOrEqual(r.series[i - 1]!.invested),
    );
  });
});

describe("spending a fixed amount instead of buying fixed grams", () => {
  it("300 USD a month buys 4 g, 2 g and 1 g as the price climbs", () => {
    const r = run({ contribution: { mode: "amount", amount: 300 } });
    r.purchases.forEach((p, i) => close(p.grams, [4, 2, 1][i]!));
    close(r.totalGrams, 7);
    close(r.investedBase, 900);
    close(r.valueAtSpotBase, 7 * 0.75 * 400); // 2100
  });
});

describe("shop price versus raw price", () => {
  it("retail basis with the susut deduction pays out 95% of the metal value", () => {
    const r = run({ basis: "retail", deductionPct: 5 }); // country premium is 0, so purchase costs are unchanged
    close(r.investedBase, 1050);
    close(r.valueAtSpotBase, 1800);
    close(r.valueSellBackBase, 1710); // 1800 x 0.95
    close(r.goldVsSavingsBase, 1710 - 1056.015);
  });

  it("buying uses exactly the same all-in factors as the calculator (premium, duty, then tax)", () => {
    const shop: Country = {
      id: "s",
      name: "Shop",
      currency: "USD",
      rate: 1,
      duty: 6,
      tax: 3,
      premium: 6,
    };
    const r = run({
      months: 1,
      country: shop,
      basis: "retail",
      purity: "916",
      contribution: { mode: "grams", grams: 1 },
    });
    const june = r.purchases[0]!;
    const expected = analyze(
      {
        weight: 1,
        purity: "916",
        feeMode: "flat",
        fee: 0,
        melting: 0,
        askingPrice: 0,
        countryId: "s",
      },
      shop,
      june.xauUsd,
      "retail",
    ).totalUsd;
    close(june.costUsd, expected);
  });
});

describe("currencies", () => {
  it("MYR base uses the historical USD/MYR of each purchase day", () => {
    const r = run({ baseCurrency: "MYR", savingsRatePct: 0 });
    expect(r.fxMode).toBe("historical");
    close(r.fxEnd, 5); // the latest USD/MYR in the data
    r.purchases.forEach((p, i) => close(p.costBase, [150 * 4, 300 * 5, 600 * 5][i]!)); // 600, 1500, 3000
    close(r.investedBase, 5100);
    close(r.valueAtSpotBase, 1800 * 5); // valued at the latest USD/MYR
    close(r.savingsBase, 5100); // 0% interest: you simply keep the cash
  });

  it("any other currency uses today's rate for every date and says so", () => {
    const r = run({ baseCurrency: "SGD", baseRateToday: 1.3 });
    expect(r.fxMode).toBe("today");
    close(r.fxEnd, 1.3);
    close(r.investedBase, 1050 * 1.3);
    close(r.valueAtSpotBase, 1800 * 1.3);
  });

  it("USD needs no conversion", () => {
    expect(run().fxMode).toBe("usd");
    close(run().fxEnd, 1);
  });
});

describe("the savings rate", () => {
  it("a negative rate shrinks the deposits", () => {
    const r = run({ savingsRatePct: -12 });
    close(r.savingsBase, 150 * 0.99 ** 2 + 300 * 0.99 + 600);
  });

  it("0% keeps the cash exactly", () => {
    close(run({ savingsRatePct: 0 }).savingsBase, 1050);
  });
});

describe("not enough or irregular data", () => {
  it("asking for more months than the data holds uses what exists and flags it (the partial first month is never used)", () => {
    const r = run({ months: 12 });
    expect(r.purchases.map((p) => p.date)).toEqual([
      "2026-02-02",
      "2026-03-02",
      "2026-04-01",
      "2026-05-04",
      "2026-06-01",
    ]);
    expect(r.requestedMonths).toBe(12);
    expect(r.purchaseCount).toBe(5);
    expect(r.clamped).toBe(true);
  });

  it("a month with no trading day in the data is skipped and flagged", () => {
    const noMay = build(rows.filter((x) => !x[0].startsWith("2026-05")));
    const r = run({}, noMay);
    expect(r.purchases.map((p) => p.date)).toEqual(["2026-04-01", "2026-06-01"]);
    expect(r.clamped).toBe(true);
  });

  it("when the last day of data is itself a first-of-month purchase day it is not duplicated in the series", () => {
    const r = run({}, build(rows.slice(0, 9))); // ends on 2026-06-01
    expect(r.series.map((s) => s.date)).toEqual(["2026-04-01", "2026-05-04", "2026-06-01"]);
    expect(r.endDate).toBe("2026-06-01");
  });

  it("ignores missing prices instead of producing NaN", () => {
    const holes = build(rows);
    holes.xau[5] = null; // 2026-04-15 is not a purchase day
    const r = run({}, holes);
    expect(Number.isFinite(r.investedBase) && Number.isFinite(r.savingsBase)).toBe(true);
  });
});

describe("rejects inputs that make no sense", () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("contribution %s", (grams) => {
    expect(backtestDca(history, { ...base, contribution: { mode: "grams", grams } })).toEqual({
      ok: false,
      error: "invalidContribution",
    });
    expect(
      backtestDca(history, { ...base, contribution: { mode: "amount", amount: grams } }),
    ).toEqual({ ok: false, error: "invalidContribution" });
  });

  it("a savings rate of -100% or worse, or not a number", () => {
    expect(backtestDca(history, { ...base, savingsRatePct: -100 })).toEqual({
      ok: false,
      error: "invalidRate",
    });
    expect(backtestDca(history, { ...base, savingsRatePct: Number.NaN })).toEqual({
      ok: false,
      error: "invalidRate",
    });
  });

  it("no data, or zero months", () => {
    expect(backtestDca({ dates: [], xau: [], usdmyr: [] }, base)).toEqual({
      ok: false,
      error: "noData",
    });
    expect(backtestDca(history, { ...base, months: 0 })).toEqual({ ok: false, error: "noData" });
  });
});
