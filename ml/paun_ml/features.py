"""Features (model inputs) and labels (what we predict) - the single source of truth.

WHAT   Turns raw daily closes into numbers describing "what the market looks like today", and labels each
       past day with what gold did over the NEXT 5 sessions relative to how volatile gold currently is.
WHY    Models cannot learn from raw prices: gold at $4,000 vs $1,300 are different scales, and a model would
       just memorise "prices go up". Every feature here is therefore a *ratio, return or change*
       (stationary), so a pattern learned in 2012 still means something in 2026.
LABELS A fixed "+/-1.5% = big move" rule means different things in calm and wild markets: in wild periods
       most weeks are "breakouts", in calm ones almost none. The class mix then tracks volatility, not
       direction. So the threshold is volatility-scaled:  threshold_t = LABEL_K * sigma_t  where sigma_t is
       the EWMA forecast of the next 5-session volatility (vol.py). Classes now mean "unusually large
       fall / rise for current conditions", and the class mix stays stable over time.
RULES  1. One row = one gold trading session.
       2. A feature or label threshold at row t may only use data up to and including close t.
          tests/test_features.py enforces this by appending future rows and checking nothing moves.
       3. The TypeScript port in src/lib/forecast/features.ts MUST match these formulas exactly
          (checked by a golden-fixture test) - that is why RSI, std etc. use the simplest definitions.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .constants import BURN_IN, HORIZON, LABEL_K
from .vol import LABEL_VOL_LAMBDA, ewma_hday_var

CLASS_NAMES = ["Bearish Retracement", "Sideways Consolidation", "Bullish Breakout"]
RAW_COLUMNS = ["xau", "dxy", "us10y", "real10y", "gvz", "oil", "usdmyr", "sp500"]

# The original 18 inputs.
BASE_FEATURES = [
    "ret_1d", "ret_5d", "ret_20d", "vol_20d",
    "rsi_14", "bb_bandwidth", "bb_pct_b",
    "ma20_spread", "ma50_spread", "ma200_spread",
    "dxy_ret_5d", "us10y_chg_5d", "real10y_chg_5d",
    "oil_ret_5d", "usdmyr_ret_5d", "sp500_ret_5d",
    "gvz_level", "gvz_chg_5d",
]
# Direction signals divided by current volatility, so "+2%" means the same thing in calm and wild markets.
# (Trees split on one column at a time and cannot divide two features themselves.)
EXTRA_FEATURES = ["sigma_5d", "ret_5d_z", "ret_20d_z", "ma20_z", "ma50_z", "ma200_z"]
ALL_FEATURES = BASE_FEATURES + EXTRA_FEATURES
FEATURE_COLS = BASE_FEATURES  # DEFAULT production list; the experiments pick the real one -> model_config.py
MIN_HISTORY = 200  # rows needed before ma200_spread is defined

# Feature groups used by the ablation experiment ("does removing this family help?").
FEATURE_GROUPS = {
    "momentum": ["ret_1d", "ret_5d", "ret_20d", "ret_5d_z", "ret_20d_z"],
    "trend": ["ma20_spread", "ma50_spread", "ma200_spread", "ma20_z", "ma50_z", "ma200_z"],
    "oscillators": ["rsi_14", "bb_pct_b"],
    "volatility": ["vol_20d", "bb_bandwidth", "sigma_5d"],
    "rates": ["us10y_chg_5d", "real10y_chg_5d"],
    "dollar_fx": ["dxy_ret_5d", "usdmyr_ret_5d"],
    "risk": ["oil_ret_5d", "sp500_ret_5d"],
    "gvz": ["gvz_level", "gvz_chg_5d"],
}

# Plain-language meaning of every feature (shown in the notebook, README and report).
FEATURE_DOC = {
    "ret_1d": "Gold's return over the last 1 session (log return).",
    "ret_5d": "Gold's return over the last 5 sessions - short-term momentum.",
    "ret_20d": "Gold's return over the last 20 sessions - medium-term momentum.",
    "vol_20d": "Standard deviation of daily returns over 20 sessions - how jumpy gold has been lately.",
    "rsi_14": "Relative Strength Index (0-100): >70 = recent gains dominate (stretched), <30 = recent losses dominate.",
    "bb_bandwidth": "Bollinger band width / price: how wide the 20-day +/-2 sigma envelope is (volatility, scaled).",
    "bb_pct_b": "Where price sits inside the Bollinger envelope: 0 = lower band, 1 = upper band.",
    "ma20_spread": "Price vs its 20-day average, in % - distance from the short-term trend.",
    "ma50_spread": "Price vs its 50-day average, in % - distance from the medium-term trend.",
    "ma200_spread": "Price vs its 200-day average, in % - distance from the long-term trend.",
    "dxy_ret_5d": "5-session change in the US Dollar Index. A stronger dollar usually weighs on gold.",
    "us10y_chg_5d": "5-session change in the nominal US 10-year yield (percentage points).",
    "real10y_chg_5d": "5-session change in the 10-year TIPS real yield - gold's classic opportunity cost.",
    "oil_ret_5d": "5-session WTI oil return (clipped to +/-50%) - inflation / risk proxy.",
    "usdmyr_ret_5d": "5-session change in USD/MYR - matters for the ringgit price Malaysians see.",
    "sp500_ret_5d": "5-session S&P 500 return - risk-on / risk-off sentiment.",
    "gvz_level": "CBOE Gold Volatility Index level - what options traders expect gold's volatility to be.",
    "gvz_chg_5d": "5-session change in GVZ - is expected volatility rising or falling.",
    "sigma_5d": "Expected size of gold's next-5-session move (EWMA volatility). Also sets today's 'big move' threshold.",
    "ret_5d_z": "Last 5-session return measured in units of expected volatility (a 'z-score' of momentum).",
    "ret_20d_z": "Last 20-session return measured in units of expected volatility.",
    "ma20_z": "Distance from the 20-day average in units of expected volatility.",
    "ma50_z": "Distance from the 50-day average in units of expected volatility.",
    "ma200_z": "Distance from the 200-day average in units of expected volatility.",
}


def _logret(s: pd.Series, n: int) -> pd.Series:
    return np.log(s / s.shift(n))


def expected_sigma(raw: pd.DataFrame, horizon: int = HORIZON) -> pd.Series:
    """EWMA forecast of the next `horizon`-session volatility (a fraction, e.g. 0.028 = 2.8%), causal."""
    r = _logret(raw["xau"], 1).to_numpy()
    return pd.Series(np.sqrt(ewma_hday_var(r, LABEL_VOL_LAMBDA, horizon)), index=raw.index, name="sigma")


def compute_features(raw: pd.DataFrame) -> pd.DataFrame:
    """All candidate features (ALL_FEATURES order). Callers select the production subset."""
    g = raw["xau"]
    r1 = _logret(g, 1)
    f = pd.DataFrame(index=raw.index)
    f["ret_1d"] = r1
    f["ret_5d"] = _logret(g, 5)
    f["ret_20d"] = _logret(g, 20)
    f["vol_20d"] = r1.rolling(20).std(ddof=0)

    # RSI with a plain rolling mean (not Wilder's smoothing): same idea, but trivial to port to TypeScript.
    delta = g.diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    f["rsi_14"] = 100 - 100 / (1 + gain / (loss + 1e-9))

    ma20 = g.rolling(20).mean()
    sd20 = g.rolling(20).std(ddof=0)  # ddof=0 (population std): matches the one-line TS implementation
    f["bb_bandwidth"] = 4 * sd20 / ma20
    f["bb_pct_b"] = (g - (ma20 - 2 * sd20)) / (4 * sd20 + 1e-9)
    f["ma20_spread"] = g / ma20 - 1
    f["ma50_spread"] = g / g.rolling(50).mean() - 1
    f["ma200_spread"] = g / g.rolling(200).mean() - 1

    f["dxy_ret_5d"] = _logret(raw["dxy"], 5)
    f["us10y_chg_5d"] = raw["us10y"].diff(5)
    f["real10y_chg_5d"] = raw["real10y"].diff(5)  # real10y was already lagged one session in data.py
    # WTI printed a negative price in Apr-2020, so use a clipped simple return instead of log.
    f["oil_ret_5d"] = (raw["oil"] / raw["oil"].shift(5) - 1).clip(-0.5, 0.5)
    f["usdmyr_ret_5d"] = _logret(raw["usdmyr"], 5)
    f["sp500_ret_5d"] = _logret(raw["sp500"], 5)
    f["gvz_level"] = raw["gvz"]
    f["gvz_chg_5d"] = raw["gvz"].diff(5)

    sigma = expected_sigma(raw)
    f["sigma_5d"] = sigma
    f["ret_5d_z"] = f["ret_5d"] / sigma
    f["ret_20d_z"] = f["ret_20d"] / sigma
    f["ma20_z"] = f["ma20_spread"] / sigma
    f["ma50_z"] = f["ma50_spread"] / sigma
    f["ma200_z"] = f["ma200_spread"] / sigma
    return f[ALL_FEATURES]


def compute_labels(raw: pd.DataFrame, horizon: int = HORIZON, k: float = LABEL_K) -> pd.DataFrame:
    """Forward log return, today's volatility-scaled threshold, and the regime class.

    regime: 0 = fell by more than k*sigma, 2 = rose by more than k*sigma, 1 = in between.
    NaN for the last `horizon` rows (future unknown) and for the first BURN_IN rows (EWMA warming up).
    """
    g = raw["xau"]
    fwd = np.log(g.shift(-horizon) / g)
    sigma = expected_sigma(raw, horizon)
    thr = k * sigma
    regime = pd.Series(np.where(fwd < -thr, 0, np.where(fwd > thr, 2, 1)), index=raw.index, dtype=float)
    regime = regime.where(fwd.notna())
    regime.iloc[:BURN_IN] = np.nan
    return pd.DataFrame({"fwd_ret": fwd, "sigma": sigma, "threshold": thr, "regime": regime})


def training_frame(raw: pd.DataFrame) -> pd.DataFrame:
    """Rows with complete features AND a known label. Newest `horizon` rows are excluded here
    only; the live feature row is always taken from compute_features(raw).iloc[-1]."""
    return pd.concat([compute_features(raw), compute_labels(raw)], axis=1).dropna()


def feature_spec(features: list[str] | None = None) -> dict:
    """What the browser port must reproduce. `features` = the production subset the model was trained on."""
    return {
        "horizon": HORIZON,
        "label_k": LABEL_K,
        "label_vol_lambda": LABEL_VOL_LAMBDA,
        "classes": CLASS_NAMES,
        "raw_columns": RAW_COLUMNS,
        "features": list(features or FEATURE_COLS),
        "all_features": ALL_FEATURES,
        "min_history": MIN_HISTORY,
    }
