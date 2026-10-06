/**
 * TypeScript port of ml/paun_ml/features.py (and vol.py's EWMA). The formulas are intentionally the simplest
 * possible definitions so the two implementations can be proven identical: forecast.test.ts recomputes the
 * features from the snapshot's raw history and compares them with the values Python wrote in the same file.
 *
 * Conventions (same as Python): one index = one gold session, a value at i uses data up to and including i,
 * NaN means "not available", and a rolling window needs ALL of its values to be present.
 */
import { ALL_FEATURES, type FeatureName, type RawSeries } from "./types";

export const HORIZON = 5;
export const EWMA_LAMBDA = 0.94;

const at = (a: number[], i: number) => a[i] ?? NaN;

/** ln(s[i] / s[i-n]) */
export function logret(s: number[], n: number): number[] {
  return s.map((v, i) => (i >= n ? Math.log(v / at(s, i - n)) : NaN));
}

/** s[i] - s[i-n] */
export function diff(s: number[], n: number): number[] {
  return s.map((v, i) => (i >= n ? v - at(s, i - n) : NaN));
}

/** Rolling mean; NaN unless the full window is present (pandas min_periods = window). */
export function rollingMean(a: number[], w: number): number[] {
  return a.map((_, i) => {
    if (i < w - 1) return NaN;
    let sum = 0;
    for (let j = i - w + 1; j <= i; j++) sum += at(a, j);
    return sum / w;
  });
}

/** Rolling POPULATION standard deviation (ddof = 0), like pandas .rolling(w).std(ddof=0). */
export function rollingStd0(a: number[], w: number): number[] {
  const mean = rollingMean(a, w);
  return a.map((_, i) => {
    const m = at(mean, i);
    if (Number.isNaN(m)) return NaN;
    let ss = 0;
    for (let j = i - w + 1; j <= i; j++) ss += (at(a, j) - m) ** 2;
    return Math.sqrt(ss / w);
  });
}

/** numpy.nanvar (ddof = 0): variance of the finite values only. */
export function nanvar(a: number[]): number {
  const v = a.filter((x) => Number.isFinite(x));
  if (v.length === 0) return NaN;
  const m = v.reduce((p, c) => p + c, 0) / v.length;
  return v.reduce((p, c) => p + (c - m) ** 2, 0) / v.length;
}

/**
 * EWMA variance scaled to `h` sessions: s2[t] = lam*s2[t-1] + (1-lam)*r[t]^2, output s2[t]*h.
 * Starts from the variance of the first 50 returns (forgotten after a few hundred rows). A missing return adds no shock.
 */
export function ewmaHdayVar(r: number[], lam = EWMA_LAMBDA, h = HORIZON): number[] {
  let prev = nanvar(r.slice(0, 50));
  return r.map((x) => {
    const shock = Number.isNaN(x) ? 0 : x;
    prev = lam * prev + (1 - lam) * shock * shock;
    return prev * h;
  });
}

const clip = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Every candidate feature for every session. Mirrors features.compute_features(). */
export function computeFeatureSeries(raw: RawSeries): Record<FeatureName, number[]> {
  const g = raw.xau;
  const n = g.length;
  const r1 = logret(g, 1);

  // RSI with a plain rolling mean (not Wilder smoothing), exactly as in Python.
  const delta = diff(g, 1);
  const gain = rollingMean(
    delta.map((d) => Math.max(d, 0)),
    14,
  );
  const loss = rollingMean(
    delta.map((d) => -Math.min(d, 0)),
    14,
  );

  const ma20 = rollingMean(g, 20);
  const sd20 = rollingStd0(g, 20);
  const ma50 = rollingMean(g, 50);
  const ma200 = rollingMean(g, 200);
  const sigma = ewmaHdayVar(r1, EWMA_LAMBDA, HORIZON).map(Math.sqrt);

  const ret5 = logret(g, 5);
  const ret20 = logret(g, 20);
  const ma20Spread = g.map((v, i) => v / at(ma20, i) - 1);
  const ma50Spread = g.map((v, i) => v / at(ma50, i) - 1);
  const ma200Spread = g.map((v, i) => v / at(ma200, i) - 1);
  const per = (f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));

  return {
    ret_1d: r1,
    ret_5d: ret5,
    ret_20d: ret20,
    vol_20d: rollingStd0(r1, 20),
    rsi_14: per((i) => 100 - 100 / (1 + at(gain, i) / (at(loss, i) + 1e-9))),
    bb_bandwidth: per((i) => (4 * at(sd20, i)) / at(ma20, i)),
    bb_pct_b: per((i) => (at(g, i) - (at(ma20, i) - 2 * at(sd20, i))) / (4 * at(sd20, i) + 1e-9)),
    ma20_spread: ma20Spread,
    ma50_spread: ma50Spread,
    ma200_spread: ma200Spread,
    dxy_ret_5d: logret(raw.dxy, 5),
    us10y_chg_5d: diff(raw.us10y, 5),
    real10y_chg_5d: diff(raw.real10y, 5),
    // WTI printed a negative price in Apr-2020, so a clipped simple return is used instead of a log return.
    oil_ret_5d: raw.oil.map((v, i) => (i >= 5 ? clip(v / at(raw.oil, i - 5) - 1, -0.5, 0.5) : NaN)),
    usdmyr_ret_5d: logret(raw.usdmyr, 5),
    sp500_ret_5d: logret(raw.sp500, 5),
    gvz_level: [...raw.gvz],
    gvz_chg_5d: diff(raw.gvz, 5),
    sigma_5d: sigma,
    ret_5d_z: per((i) => at(ret5, i) / at(sigma, i)),
    ret_20d_z: per((i) => at(ret20, i) / at(sigma, i)),
    ma20_z: per((i) => at(ma20Spread, i) / at(sigma, i)),
    ma50_z: per((i) => at(ma50Spread, i) / at(sigma, i)),
    ma200_z: per((i) => at(ma200Spread, i) / at(sigma, i)),
  };
}

/** The newest session's feature vector (what the live forecast is computed from). */
export function latestFeatures(raw: RawSeries): Record<FeatureName, number> {
  const series = computeFeatureSeries(raw);
  return Object.fromEntries(ALL_FEATURES.map((k) => [k, series[k].at(-1) ?? NaN])) as Record<
    FeatureName,
    number
  >;
}
