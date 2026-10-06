import numpy as np
import pandas as pd
import pytest
from matplotlib.figure import Figure
from test_features import synthetic_raw

from paun_ml import bands as bands_mod
from paun_ml import evaluate as ev
from paun_ml import train_regime as tr
from paun_ml.features import compute_labels


def calibrated_probs(n=30000, seed=0):
    rng = np.random.default_rng(seed)
    p = rng.dirichlet([2, 3, 2], n)
    y = np.array([rng.choice(3, p=row) for row in p])
    return y, p


def test_ece_is_near_zero_when_probabilities_are_calibrated():
    y, p = calibrated_probs()
    assert ev.ece(y, p) < 0.02


def test_ece_is_large_when_the_model_is_overconfident():
    y, p = calibrated_probs()
    sharp = p**4 / (p**4).sum(1, keepdims=True)  # same ranking, exaggerated certainty
    assert ev.ece(y, sharp) > 0.05 > ev.ece(y, p)


def _inputs(n_beating):
    folds = [{"beats_prior": i < n_beating} for i in range(5)]
    y, p = calibrated_probs(3000)
    oof = pd.DataFrame(p, columns=ev.PROB_COLS)
    oof["y"] = y
    for k, v in enumerate(np.bincount(y, minlength=3) / len(y)):  # climatology columns, as walk_forward_cv emits
        oof[f"q{k}"] = v
    test_m = {"logloss": 1.0, "logloss_prior": 1.1}
    band = {"garch": {"coverage_p10_p90": 0.76, "pinball": 0.0100},
            "ewma": {"coverage_p10_p90": 0.80, "pinball": 0.0099},
            "constant_vol_baseline": {"coverage_p10_p90": 0.5, "pinball": 0.0106}}
    return folds, oof, test_m, band


def test_acceptance_requires_enough_winning_folds():
    ok = ev.acceptance(*_inputs(3))
    bad = ev.acceptance(*_inputs(2))
    assert ok["summary"]["model_a_ship"] is True
    assert bad["summary"]["model_a_ship"] is False
    assert {c["id"]: c["passed"] for c in bad["checks"]}["A2"] is False
    assert bad["summary"]["model_b_ship"] is True  # bands judged independently of the regime model
    assert ok["summary"]["recommended_band"] == "ewma"  # closest to the 80% target


def test_rule_a4_blocks_a_model_whose_gain_is_not_statistically_real():
    """Passing A1-A3 by luck must not be enough: A4 needs the 90% interval of the gain to exclude 0."""
    folds, oof, test_m, band = _inputs(5)
    ok = ev.acceptance(folds, oof, test_m, band)
    assert {c["id"]: c["passed"] for c in ok["checks"]}["A4"] and ok["summary"]["model_a_ship"]
    # same fold/test/calibration numbers, but the model's probabilities are just the base rates -> gain is exactly 0
    flat = oof.copy()
    flat[ev.PROB_COLS] = flat[["q0", "q1", "q2"]].to_numpy()
    bad = ev.acceptance(folds, flat, test_m, band)
    checks = {c["id"]: c["passed"] for c in bad["checks"]}
    assert checks["A1"] and checks["A2"] and checks["A3"] and checks["A4"] is False
    assert bad["summary"]["model_a_ship"] is False and bad["summary"]["skill_evidence"] is False


def test_acceptance_fails_bands_with_poor_coverage():
    folds, oof, test_m, band = _inputs(5)
    band["ewma"]["coverage_p10_p90"] = band["garch"]["coverage_p10_p90"] = 0.60
    assert ev.acceptance(folds, oof, test_m, band)["summary"]["model_b_ship"] is False


@pytest.fixture(scope="module")
def pipeline():
    """Run the real train steps on synthetic data with a tiny model (seconds, no network)."""
    from paun_ml.features import BASE_FEATURES, compute_labels, training_frame

    saved = tr.PARAMS["iterations"]
    tr.PARAMS["iterations"] = 20  # tiny model: we test plumbing here, not predictive skill
    try:
        raw = synthetic_raw(700)
        df = training_frame(raw)
        X, y = df[BASE_FEATURES], df["regime"].astype(int)
        n_test = 80
        n_tr = tr.split_sizes(len(df), n_test)
        folds, oof = tr.walk_forward_cv(X, y, n_tr)
        test_m, test_df, _ = tr.holdout_test(X, y, n_tr, n_test)
    finally:
        tr.PARAMS["iterations"] = saved
    return raw, df, y, folds, oof, test_m, test_df, n_test, n_tr


def test_walk_forward_cv_respects_time_and_gap(pipeline):
    _, df, _, folds, oof, _, _, _, n_tr = pipeline
    assert len(folds) == 5
    assert oof.index.is_monotonic_increasing and oof.index.max() <= df.index[n_tr - 1]
    # each validation window starts after its training rows (walk-forward, never shuffled)
    assert [f["train_rows"] for f in folds] == sorted(f["train_rows"] for f in folds)
    assert np.allclose(oof[ev.PROB_COLS].sum(axis=1), 1)


def test_holdout_is_the_last_rows_and_after_a_purge_gap(pipeline):
    _, df, _, _, _, test_m, test_df, n_test, n_tr = pipeline
    assert test_df.index[0] == df.index[-n_test] and len(test_df) == n_test
    assert n_tr + 5 + n_test == len(df)
    assert set(test_m) >= {"logloss", "logloss_prior", "brier", "accuracy", "macro_f1", "beats_prior"}


def test_all_figures_render_and_report_is_written(pipeline, tmp_path):
    raw, df, y, folds, oof, test_m, test_df, n_test, _ = pipeline
    be = bands_mod.evaluate_test_window(raw, n_test)
    for fig in (ev.fig_gold_history(raw), ev.fig_class_mix(y), ev.fig_cv_improvement(folds), ev.fig_reliability(oof),
                ev.fig_confusion(test_df), ev.fig_rolling_logloss(oof, test_df), ev.fig_bands(be),
                ev.fig_importance({"ret_5d": 3.0, "rsi_14": 2.0})):
        assert isinstance(fig, Figure)
    ctx = {"raw": raw, "df": df, "y": y, "labels": compute_labels(raw), "folds": folds, "oof": oof, "test_m": test_m, "test_df": test_df,
           "imp": {"ret_5d": 3.0, "rsi_14": 2.0}, "band_eval": be, "n_test": n_test,
           "export": {"max_abs_diff": 0.0, "zipmap_stripped": True}}
    verdict = ev.write_report(tmp_path, ctx)
    text = (tmp_path / "latest.md").read_text(encoding="utf-8")
    assert "## Verdict" in text and (tmp_path / "figures" / "bands.png").exists()
    assert isinstance(verdict["summary"]["model_a_ship"], bool)
