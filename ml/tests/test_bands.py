import numpy as np

from paun_ml.bands import evaluate, ewma_hday_var, garch_hday_var, garch_next_var, standardized_quantiles

OMEGA, ALPHA, BETA = 2e-6, 0.06, 0.92


def test_garch_hday_var_matches_brute_force_expectation():
    rng = np.random.default_rng(1)
    r = rng.normal(0, 0.01, 300)
    s2 = garch_next_var(r, OMEGA, ALPHA, BETA)
    closed = garch_hday_var(s2, OMEGA, ALPHA, BETA, h=5)

    # E[sigma^2_{t+k}] recursion: E[s2_{t+k+1}] = omega + (alpha+beta) * E[s2_{t+k}]
    t = 250
    expected, cur = 0.0, s2[t]
    for _ in range(5):
        expected += cur
        cur = OMEGA + (ALPHA + BETA) * cur
    assert closed[t] == np.float64(expected) or abs(closed[t] - expected) < 1e-15


def test_garch_variance_reverts_to_unconditional_for_long_horizon():
    s2 = np.array([1e-3])
    v = OMEGA / (1 - ALPHA - BETA)
    h = 500_000  # persistence 0.98 -> the initial shock adds a fixed 0.045 to the sum; it must wash out
    out = garch_hday_var(s2, OMEGA, ALPHA, BETA, h=h)
    assert abs(out[0] / h - v) / v < 0.01


def test_ewma_is_positive_and_scales_with_horizon():
    r = np.random.default_rng(2).normal(0, 0.01, 200)
    assert np.all(ewma_hday_var(r, h=5) > 0)
    np.testing.assert_allclose(ewma_hday_var(r, h=10), 2 * ewma_hday_var(r, h=5))


def test_standardized_quantile_bands_cover_about_eighty_percent_in_sample():
    rng = np.random.default_rng(3)
    hvar = np.full(5000, 5 * 0.01**2)
    fwd = rng.normal(0, np.sqrt(hvar))
    q = standardized_quantiles(fwd, hvar)
    s = np.sqrt(hvar)
    rep = evaluate(fwd, {k: s * v for k, v in q.items()})
    assert abs(rep["coverage_p10_p90"] - 0.8) < 0.02
