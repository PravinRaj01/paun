import numpy as np
import pandas as pd
import pytest

from paun_ml.constants import BURN_IN, HORIZON, LABEL_K
from paun_ml.features import ALL_FEATURES, compute_features, compute_labels, training_frame


def synthetic_raw(n: int = 600, seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2018-01-01", periods=n)
    walk = lambda start, vol: start * np.exp(np.cumsum(rng.normal(0, vol, n)))
    return pd.DataFrame(
        {
            "xau": walk(1300, 0.01),
            "dxy": walk(95, 0.004),
            "us10y": 2 + np.cumsum(rng.normal(0, 0.03, n)),
            "real10y": 0.5 + np.cumsum(rng.normal(0, 0.03, n)),
            "gvz": 15 + np.abs(np.cumsum(rng.normal(0, 0.3, n))),
            "oil": walk(60, 0.02),
            "usdmyr": walk(4.1, 0.003),
            "sp500": walk(2700, 0.008),
        },
        index=idx,
    )


def test_features_have_no_lookahead():
    raw = synthetic_raw()
    cut = 450
    short = compute_features(raw.iloc[:cut])
    full = compute_features(raw)
    pd.testing.assert_frame_equal(short, full.iloc[:cut])


def test_labels_use_exact_forward_window_and_scaled_threshold():
    raw = synthetic_raw()
    lab = compute_labels(raw)
    g = raw["xau"].to_numpy()
    t = 300
    fwd = np.log(g[t + HORIZON] / g[t])
    thr = lab["threshold"].iloc[t]
    assert lab["fwd_ret"].iloc[t] == pytest.approx(fwd)
    assert thr == pytest.approx(LABEL_K * lab["sigma"].iloc[t])
    expected = 0 if fwd < -thr else 2 if fwd > thr else 1
    assert lab["regime"].iloc[t] == expected
    assert lab["regime"].iloc[-HORIZON:].isna().all()  # future unknown
    assert lab["regime"].iloc[:BURN_IN].isna().all()  # EWMA still warming up


def test_label_thresholds_are_causal():
    """A day's 'big move' threshold may only depend on the past: appending future rows changes nothing."""
    raw = synthetic_raw()
    cut = 450
    short, full = compute_labels(raw.iloc[:cut]), compute_labels(raw)
    pd.testing.assert_series_equal(short["threshold"], full["threshold"].iloc[:cut])
    pd.testing.assert_series_equal(short["regime"].iloc[: cut - HORIZON], full["regime"].iloc[: cut - HORIZON])


def test_class_mix_is_stable_between_calm_and_wild_markets():
    """The whole point of scaled labels: wild markets must not turn into 'all breakouts'."""
    rng = np.random.default_rng(11)
    vol = np.r_[np.full(1500, 0.004), np.full(1500, 0.02)]  # calm half then 5x wilder half
    gold = pd.DataFrame({"xau": 1300 * np.exp(np.cumsum(rng.normal(0, vol)))}, index=pd.bdate_range("2010-01-01", periods=3000))
    reg = compute_labels(gold)["regime"]
    calm, wild = reg.iloc[BURN_IN:1400].dropna(), reg.iloc[1700:].dropna()
    for part in (calm, wild):
        assert 0.40 < (part == 1).mean() < 0.68  # sideways share ~ 55% in both regimes
    assert abs((calm == 1).mean() - (wild == 1).mean()) < 0.10


def test_training_frame_is_complete_and_excludes_unlabelled_tail():
    raw = synthetic_raw()
    df = training_frame(raw)
    assert list(df.columns[: len(ALL_FEATURES)]) == ALL_FEATURES
    assert not df.isna().any().any()
    assert df.index[-1] == raw.index[-1 - HORIZON]
    # the live feature row is still available for the newest session
    assert compute_features(raw).iloc[-1].notna().all()


def test_negative_oil_price_does_not_produce_nan():
    raw = synthetic_raw()
    raw.loc[raw.index[300], "oil"] = -37.0
    f = compute_features(raw)
    assert f["oil_ret_5d"].iloc[300:310].notna().all()
    assert f["oil_ret_5d"].abs().max() <= 0.5
