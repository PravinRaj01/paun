import { z } from "zod";

/** The raw daily series the snapshot carries (one row = one gold trading session). Mirrors ml/paun_ml/data.py. */
export const RAW_KEYS = [
  "xau",
  "dxy",
  "us10y",
  "real10y",
  "gvz",
  "oil",
  "usdmyr",
  "sp500",
] as const;
export type RawKey = (typeof RAW_KEYS)[number];

/** All candidate features in the SAME order as ml/paun_ml/features.py ALL_FEATURES. */
export const ALL_FEATURES = [
  "ret_1d",
  "ret_5d",
  "ret_20d",
  "vol_20d",
  "rsi_14",
  "bb_bandwidth",
  "bb_pct_b",
  "ma20_spread",
  "ma50_spread",
  "ma200_spread",
  "dxy_ret_5d",
  "us10y_chg_5d",
  "real10y_chg_5d",
  "oil_ret_5d",
  "usdmyr_ret_5d",
  "sp500_ret_5d",
  "gvz_level",
  "gvz_chg_5d",
  "sigma_5d",
  "ret_5d_z",
  "ret_20d_z",
  "ma20_z",
  "ma50_z",
  "ma200_z",
] as const;
export type FeatureName = (typeof ALL_FEATURES)[number];

const quantiles = z.object({ q10: z.number(), q50: z.number(), q90: z.number() });
const series = z.array(z.number().nullable());

export const bandsParamsSchema = z.object({
  horizon: z.number(),
  garch: z.object({ omega: z.number(), alpha: z.number(), beta: z.number(), nu: z.number() }),
  ewma_lambda: z.number(),
  quantiles_garch: quantiles,
  quantiles_ewma: quantiles,
});

const driverSchema = z.object({
  feature: z.string(),
  label: z.string(),
  value: z.number(),
  effect: z.number(),
  direction: z.enum(["raises", "lowers"]),
  class: z.string(),
});

/** The one JSON the app fetches daily (built by ml/paun_ml/snapshot.py). Only the fields the app uses are validated. */
export const snapshotSchema = z.object({
  schema: z.literal(1),
  generatedAt: z.string(),
  asOf: z.string(),
  horizon: z.number(),
  spotXauUsd: z.number(),
  fx: z.record(z.string(), z.number()),
  forecast: z.object({
    classes: z.array(z.string()),
    regime_shipped: z.boolean(),
    regime_probs: z.array(z.number()).nullable(),
    threshold_pct: z.number(),
    drivers: z.array(driverSchema),
    features: z.record(z.string(), z.number()),
    bands_usd_oz: z.object({ garch: quantiles, ewma: quantiles }),
    recommended_band: z.enum(["garch", "ewma"]),
    garch_hday_var: z.number(),
  }),
  bandsParams: bandsParamsSchema,
  history: z
    .object({ dates: z.array(z.string()) })
    .and(
      z.object(
        Object.fromEntries(RAW_KEYS.map((k) => [k, series])) as Record<RawKey, typeof series>,
      ),
    ),
  longHistory: z.object({ dates: z.array(z.string()), xau: series, usdmyr: series }),
});

export type Snapshot = z.infer<typeof snapshotSchema>;
export type BandsParams = z.infer<typeof bandsParamsSchema>;
export type BandKey = "q10" | "q50" | "q90";
export type Bands = Record<BandKey, number>;
export type BandMethod = "garch" | "ewma";
export type RawSeries = Record<RawKey, number[]>; // nulls turned into NaN
