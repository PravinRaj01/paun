import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bandEdges, computeBands, garchHdayVar, garchNextVar } from "./bands";
import {
  computeFeatureSeries,
  ewmaHdayVar,
  latestFeatures,
  logret,
  nanvar,
  rollingMean,
  rollingStd0,
} from "./features";
import { buildForecast, rawFromSnapshot, STALE_AFTER_DAYS } from "./forecast";
import { parseSnapshot } from "./snapshot";
import { ALL_FEATURES, type RawSeries } from "./types";

/**
 * PARITY: ml/paun_ml/snapshot.py wrote this file from the Python pipeline - raw history, the features it computed
 * from that history, and the bands. We recompute everything in TypeScript and require agreement. Tolerances are the
 * rounding the file itself applies (features: 6 decimals; bands: cents), not slack for formula differences.
 */
const fixture = JSON.parse(
  readFileSync(new URL("../../../public/data/market-snapshot.json", import.meta.url), "utf8"),
);
const snap = parseSnapshot(fixture);
const raw = rawFromSnapshot(snap);

describe("parity with the Python pipeline (same snapshot file)", () => {
  it("recomputes every feature Python published", () => {
    const ts = latestFeatures(raw) as Record<string, number>;
    const published = Object.entries(snap.forecast.features);
    expect(published.length).toBeGreaterThanOrEqual(15);
    for (const [name, pyValue] of published) {
      expect(ALL_FEATURES as readonly string[], `unknown feature ${name}`).toContain(name);
      expect(Math.abs((ts[name] ?? NaN) - pyValue), `feature ${name}`).toBeLessThan(2e-6);
    }
  });

  it("recomputes both price bands to the cent", () => {
    const { bands } = computeBands(raw, snap.bandsParams);
    for (const method of ["garch", "ewma"] as const) {
      for (const q of ["q10", "q50", "q90"] as const) {
        expect(
          Math.abs(bands[method][q] - snap.forecast.bands_usd_oz[method][q]),
          `${method} ${q}`,
        ).toBeLessThan(0.01);
      }
    }
  });

  it("recomputes the GARCH H-session variance", () => {
    const { hvar } = computeBands(raw, snap.bandsParams);
    expect(Math.abs(hvar.garch / snap.forecast.garch_hday_var - 1)).toBeLessThan(1e-6);
  });

  it("features never look ahead: truncating the history does not change earlier rows", () => {
    const full = computeFeatureSeries(raw);
    const cut = raw.xau.length - 60;
    const short = computeFeatureSeries(
      Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.slice(0, cut)])) as RawSeries,
    );
    for (const name of ALL_FEATURES) {
      const a = short[name];
      const b = full[name].slice(0, cut);
      a.forEach((v, i) => {
        const w = b[i] ?? NaN;
        if (Number.isNaN(v)) expect(Number.isNaN(w)).toBe(true);
        else expect(v).toBeCloseTo(w, 12);
      });
    }
  });
});

describe("building blocks", () => {
  it("rolling statistics need a full window and use the population std", () => {
    const a = [1, 2, 3, 4, 5];
    expect(rollingMean(a, 3)).toEqual([NaN, NaN, 2, 3, 4]);
    const sd = rollingStd0(a, 3);
    expect(sd[2]).toBeCloseTo(Math.sqrt(2 / 3), 12); // population: divide by 3, not 2
    expect(rollingMean([1, NaN, 3, 4], 2)[2]).toBeNaN(); // a missing value poisons its windows
  });

  it("nanvar ignores missing values and uses ddof = 0", () => {
    expect(nanvar([NaN, 1, 3])).toBeCloseTo(1, 12);
  });

  it("EWMA variance scales with the horizon and is positive", () => {
    const r = logret(raw.xau, 1);
    const h5 = ewmaHdayVar(r, 0.94, 5);
    const h10 = ewmaHdayVar(r, 0.94, 10);
    expect(h5.every((v) => v > 0)).toBe(true);
    h5.forEach((v, i) => expect(h10[i]).toBeCloseTo(2 * v, 12));
  });

  it("GARCH H-day variance equals the step-by-step expected sum", () => {
    const omega = 2e-6,
      alpha = 0.06,
      beta = 0.92;
    const s2 = garchNextVar([0.01, -0.02, 0.005, 0.03], omega, alpha, beta);
    const closed = garchHdayVar(s2, omega, alpha, beta, 5).at(-1) ?? NaN;
    let expected = 0;
    let cur = s2.at(-1) ?? NaN;
    for (let k = 0; k < 5; k++) {
      expected += cur;
      cur = omega + (alpha + beta) * cur; // E[s2_{t+k+1}] = omega + persistence * E[s2_{t+k}]
    }
    expect(closed).toBeCloseTo(expected, 15);
  });

  it("band edges are ordered and scale linearly with spot", () => {
    const q = { q10: -1.3, q50: 0.02, q90: 1.25 };
    const a = bandEdges(4000, 0.0009, q);
    expect(a.q10).toBeLessThan(a.q50);
    expect(a.q50).toBeLessThan(a.q90);
    const b = bandEdges(2000, 0.0009, q);
    expect(a.q10 / b.q10).toBeCloseTo(2, 12);
  });
});

describe("buildForecast", () => {
  const asOfMs = Date.parse(`${snap.asOf}T00:00:00Z`);

  it("anchors to the snapshot close by default and to the user's live spot when given", () => {
    const base = buildForecast(snap, undefined, asOfMs);
    expect(base.spotUsdOz).toBe(snap.spotXauUsd);
    const live = buildForecast(snap, snap.spotXauUsd * 1.1, asOfMs);
    expect(live.bands.q50 / base.bands.q50).toBeCloseTo(1.1, 10); // same expected move, applied to the live spot
  });

  it("uses the recommended band method and flags staleness", () => {
    const f = buildForecast(snap, undefined, asOfMs);
    expect(f.method).toBe(snap.forecast.recommended_band);
    expect(f.bands).toEqual(f.allBands[f.method]);
    expect(f.stale).toBe(false);
    expect(buildForecast(snap, undefined, asOfMs + (STALE_AFTER_DAYS + 1) * 86_400_000).stale).toBe(
      true,
    );
  });

  it("hides regime probabilities unless Model A passed every ship rule", () => {
    const f = buildForecast(snap, undefined, asOfMs);
    expect(f.regime.shipped).toBe(snap.forecast.regime_shipped);
    if (!f.regime.shipped) expect(f.regime.probs).toBeNull();
  });
});

describe("snapshot validation", () => {
  it("accepts the real file and rejects a changed schema or missing parts", () => {
    expect(() => parseSnapshot(fixture)).not.toThrow();
    expect(() => parseSnapshot({ ...fixture, schema: 2 })).toThrow();
    expect(() => parseSnapshot({ ...fixture, bandsParams: undefined })).toThrow();
    expect(() => parseSnapshot({ ...fixture, history: { dates: [] } })).toThrow();
  });
});
