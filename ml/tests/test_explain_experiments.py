import numpy as np
import pandas as pd
import pytest
from test_features import synthetic_raw

from paun_ml import data, explain, experiments as ex
from paun_ml import evaluate as ev
from paun_ml import train_regime as tr
from paun_ml.features import ALL_FEATURES, BASE_FEATURES, training_frame

FAST = {"iterations": 15, "depth": 3, "learning_rate": 0.1}


@pytest.fixture(scope="module")
def frame():
    df = training_frame(synthetic_raw(800))
    return df[ALL_FEATURES], df["regime"].astype(int)


@pytest.fixture(scope="module")
def model(frame):
    X, y = frame
    return tr._fit(X[BASE_FEATURES], y, {**tr.PARAMS, **FAST})


def test_shap_values_add_up_to_the_models_own_probabilities(frame, model):
    """Additivity: baseline + sum of per-feature pushes, through softmax, IS the model output."""
    X = frame[0][BASE_FEATURES]
    shap, base = explain.shap_values(model, X)
    assert shap.shape == (len(X), 3, len(BASE_FEATURES))
    np.testing.assert_allclose(explain.probabilities_from_shap(shap, base), model.predict_proba(X), atol=1e-5)


def test_top_drivers_are_named_features_with_a_direction(frame, model):
    drivers = explain.top_drivers(model, frame[0][BASE_FEATURES].iloc[[-1]], n=3)
    assert len(drivers) == 3
    assert all(d["feature"] in BASE_FEATURES and d["direction"] in ("raises", "lowers") for d in drivers)
    assert abs(drivers[0]["effect"]) >= abs(drivers[-1]["effect"])


def test_driver_stability_reports_ranks_and_bounded_overlap(frame):
    X, y = frame
    stab = explain.driver_stability(X[BASE_FEATURES], y, len(X) - 100, {**tr.PARAMS, **FAST})
    assert stab["ranks"].shape == (len(BASE_FEATURES), 5)
    assert 0.0 <= stab["overlap"] <= 1.0


def test_block_bootstrap_ci_separates_real_gain_from_noise():
    rng = np.random.default_rng(0)
    assert ev.block_bootstrap_ci(rng.normal(0.10, 0.05, 1500))[0] > 0  # clear gain: interval excludes 0
    # A 90% interval on pure noise excludes 0 about 10% of the time by construction, so test the rate, not one draw.
    covers = [
        (lambda ci: ci[0] < 0 < ci[1])(ev.block_bootstrap_ci(rng.normal(0.0, 0.05, 1000), reps=300, seed=i))
        for i in range(40)
    ]
    assert np.mean(covers) >= 0.75


def _cand(cid, gain, folds, nf=20, shrink=False, depth=4):
    return {"id": cid, "mean_gain": gain, "folds_beating": folds, "n_features": nf, "shrink": shrink, "params": {"depth": depth}}


def test_selection_rule_needs_enough_folds_then_prefers_simpler_on_ties():
    winner, qualified = ex.select_winner([_cand("A", 0.020, 2), _cand("B", 0.004, 3), _cand("C", 0.003, 4, nf=24)])
    assert (winner["id"], qualified) == ("B", True)  # A has more gain but too few folds
    tie, _ = ex.select_winner([_cand("B", 0.0040, 3, nf=24), _cand("C", 0.0030, 3, nf=18)])
    assert tie["id"] == "C"  # within tolerance -> fewer features wins
    none, ok = ex.select_winner([_cand("A", 0.01, 2), _cand("B", -0.01, 1)])
    assert ok is False and none["id"] == "A"  # nothing qualifies: best is returned but flagged


def test_shrink_weight_is_a_valid_blend(frame):
    X, y = frame
    w = tr.fit_shrink_w(X[BASE_FEATURES], y, {**tr.PARAMS, **FAST})
    assert 0.0 <= w <= 1.0


def test_experiments_run_end_to_end_and_never_touch_rows_past_the_training_boundary(frame):
    X, y = frame
    n_tr = len(X) - 100
    res = ex.run_experiments(X, y, n_tr, params=FAST, grid={"depth": [2], "l2_leaf_reg": [10]}, log=lambda *_: None)
    assert [c["id"] for c in res["candidates"]] == ["C1", "C2", "C3", "C4", "C5"]
    assert res["winner"]["id"] in {"C1", "C2", "C3", "C4", "C5"}
    for _, oof in res["cache"].values():
        assert oof.index.max() <= X.index[n_tr - 1]  # the held-out window stays unopened
    cfg = ex.config_from(res, X, y)
    assert set(cfg["features"]) <= set(ALL_FEATURES) and cfg["shrink_mode"] in ("none", "inner")


# ---------------------------------------------------------------- data cleaning
def _sources():
    gold_idx = pd.bdate_range("2020-01-01", periods=30)
    gold_idx = gold_idx.delete([10, 11])  # a holiday-style gap in gold's own calendar
    other_idx = pd.bdate_range("2019-12-20", periods=45).delete([14])  # misses a gold day
    fred_idx = pd.bdate_range("2019-12-20", periods=45)
    mk = lambda idx, f=1.0: pd.Series(np.arange(len(idx), dtype=float) * f + 100, index=idx)
    srcs = {k: mk(other_idx) for k in ("dxy", "us10y", "gvz", "oil", "usdmyr", "sp500")}
    srcs["xau"] = mk(gold_idx)
    srcs["real10y"] = mk(fred_idx)
    return srcs


def test_align_and_clean_uses_gold_calendar_forward_fills_only_and_lags_fred():
    srcs = _sources()
    out = data.align_and_clean(srcs)
    assert out.index.equals(srcs["xau"].dropna().index)  # one row per gold session
    # FRED real yield is lagged one session: value at day t is the source value of the previous FRED day
    t = out.index[5]
    prev = srcs["real10y"].index[srcs["real10y"].index.get_loc(t) - 1]
    assert out.loc[t, "real10y"] == srcs["real10y"].loc[prev]
    # no back-fill: before the first source value the frame stays NaN
    early = data.align_and_clean({**srcs, "dxy": srcs["dxy"].loc["2020-01-10":]})
    assert early["dxy"].iloc[:3].isna().all()


def test_data_quality_report_flags_gap_stale_run_and_spike():
    idx = pd.bdate_range("2020-01-01", periods=300)
    rng = np.random.default_rng(3)
    s = pd.Series(100 + np.cumsum(rng.normal(0, 0.3, 300)), index=idx)
    s.iloc[50:56] = np.nan  # 6-day gap
    s.iloc[100:110] = s.iloc[100]  # frozen feed
    s.iloc[200] += 40  # spike
    rep = data.data_quality_report(pd.DataFrame({"x": s}))
    assert rep.loc["x", "longest_gap"] == 6
    assert rep.loc["x", "longest_stale"] >= 9
    assert rep.loc["x", "extreme_moves"] >= 1
