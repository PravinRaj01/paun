/**
 * TypeScript port of ml/paun_ml/bands.py: volatility-based price bands.
 *
 * band edge = spot * exp( sqrt(H-day variance) * z_q )
 * where z_q are empirical quantiles of standardized past returns (stored in bandsParams) and the H-day
 * variance comes from a GARCH(1,1) recursion or an EWMA. No model file is needed: the parameters are numbers.
 */
import { ewmaHdayVar, HORIZON, logret } from "./features";
import type { BandMethod, Bands, BandsParams, RawSeries } from "./types";

/** s2[t] = variance forecast of the NEXT day's return, given returns up to and including t. */
export function garchNextVar(r: number[], omega: number, alpha: number, beta: number): number[] {
  let prev = omega / (1 - alpha - beta); // start at the long-run variance
  return r.map((x) => {
    const shock = Number.isNaN(x) ? 0 : x; // a missing return contributes no shock
    prev = omega + alpha * shock * shock + beta * prev;
    return prev;
  });
}

/** Total variance over the next h sessions: closed-form sum of E[s2_{t+k}], k = 1..h (mean-reverting). */
export function garchHdayVar(
  s2Next: number[],
  omega: number,
  alpha: number,
  beta: number,
  h = HORIZON,
): number[] {
  const persist = alpha + beta;
  const longRun = omega / (1 - persist);
  const factor = (1 - persist ** h) / (1 - persist);
  return s2Next.map((s) => h * longRun + (s - longRun) * factor);
}

/** Price edges for one band method: spot * exp(sqrt(hvar) * z). Monotonic as long as q10 < q50 < q90. */
export function bandEdges(spot: number, hvar: number, q: Bands): Bands {
  const s = Math.sqrt(hvar);
  return {
    q10: spot * Math.exp(s * q.q10),
    q50: spot * Math.exp(s * q.q50),
    q90: spot * Math.exp(s * q.q90),
  };
}

export type BandResult = {
  /** H-session variance of log returns for each method, at the newest close. */
  hvar: Record<BandMethod, number>;
  /** USD/oz price edges for each method, relative to `spot`. */
  bands: Record<BandMethod, Bands>;
};

/**
 * Compute both band methods at the newest close of `raw`. `spot` defaults to that close; pass the user's live
 * spot to apply the same expected move to it.
 */
export function computeBands(raw: RawSeries, params: BandsParams, spot?: number): BandResult {
  const r = logret(raw.xau, 1);
  const g = params.garch;
  const hvGarch =
    garchHdayVar(
      garchNextVar(r, g.omega, g.alpha, g.beta),
      g.omega,
      g.alpha,
      g.beta,
      params.horizon,
    ).at(-1) ?? NaN;
  const hvEwma = ewmaHdayVar(r, params.ewma_lambda, params.horizon).at(-1) ?? NaN;
  const base = spot ?? raw.xau.at(-1) ?? NaN;
  return {
    hvar: { garch: hvGarch, ewma: hvEwma },
    bands: {
      garch: bandEdges(base, hvGarch, params.quantiles_garch),
      ewma: bandEdges(base, hvEwma, params.quantiles_ewma),
    },
  };
}
