/** Turns the daily snapshot into what the UI shows. Pure functions - no fetching, no React. */
import { computeBands } from "./bands";
import { latestFeatures } from "./features";
import {
  RAW_KEYS,
  type BandMethod,
  type Bands,
  type FeatureName,
  type RawSeries,
  type Snapshot,
} from "./types";

/** A snapshot older than this many days (weekends and holidays are normal) is flagged as stale in the UI. */
export const STALE_AFTER_DAYS = 5;

export function rawFromSnapshot(s: Snapshot): RawSeries {
  const h = s.history;
  return Object.fromEntries(RAW_KEYS.map((k) => [k, h[k].map((v) => v ?? NaN)])) as RawSeries;
}

export type Forecast = {
  asOf: string;
  ageDays: number;
  stale: boolean;
  /** Spot the bands are anchored to (USD/oz): the user's live spot if given, else the snapshot close. */
  spotUsdOz: number;
  snapshotSpotUsdOz: number;
  horizonSessions: number;
  /** The band method that did best in evaluation (rules B1/B2) and its edges (USD/oz). */
  method: BandMethod;
  bands: Bands;
  allBands: Record<BandMethod, Bands>;
  /** Today's "big move" threshold: the % move over the horizon that counts as unusually large. */
  thresholdPct: number;
  /** Regime probabilities exist only when Model A passed all ship rules (A1-A4); otherwise the UI shows bands only. */
  regime: { shipped: boolean; classes: string[]; probs: number[] | null };
  features: Record<FeatureName, number>;
};

export function buildForecast(
  snap: Snapshot,
  liveSpotUsdOz?: number,
  now: number = Date.now(),
): Forecast {
  const raw = rawFromSnapshot(snap);
  const spot = liveSpotUsdOz && liveSpotUsdOz > 0 ? liveSpotUsdOz : snap.spotXauUsd;
  const { bands } = computeBands(raw, snap.bandsParams, spot);
  const ageDays = Math.floor((now - Date.parse(`${snap.asOf}T00:00:00Z`)) / 86_400_000);
  const method = snap.forecast.recommended_band;
  return {
    asOf: snap.asOf,
    ageDays,
    stale: ageDays > STALE_AFTER_DAYS,
    spotUsdOz: spot,
    snapshotSpotUsdOz: snap.spotXauUsd,
    horizonSessions: snap.horizon,
    method,
    bands: bands[method],
    allBands: bands,
    thresholdPct: snap.forecast.threshold_pct,
    regime: {
      shipped: snap.forecast.regime_shipped,
      classes: snap.forecast.classes,
      probs: snap.forecast.regime_probs,
    },
    features: latestFeatures(raw),
  };
}
