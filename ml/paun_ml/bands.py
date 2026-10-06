"""Model B: volatility-based price bands (GARCH(1,1) or EWMA x empirical quantiles).

WHAT   For a forecast made at today's close, give a P10 / P50 / P90 range for the gold price
       H sessions ahead (H = 5, about 7 calendar days).
WHY    Gold's *direction* is nearly unpredictable, but its *volatility clusters*: calm weeks follow
       calm weeks, wild weeks follow wild weeks. So we forecast "how far can it plausibly move"
       instead of "where will it go". No neural network is needed for that.
HOW    1. Forecast the variance of the next H daily returns (GARCH recursion or EWMA).
       2. Divide historical H-day returns by that forecast spread -> "standardized" returns, which
          should look the same in calm and wild periods. Take their 10/50/90% quantiles (z values).
          Using empirical quantiles instead of a bell curve keeps fat tails and skew.
       3. Band = spot * exp(sqrt(H-day variance) * z).
INPUT  raw daily closes (see data.py).   OUTPUT  bands_params.json + a test-year evaluation.

Every recursion here is mirrored in src/lib/forecast/bands.ts; keep the two in sync.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .constants import BURN_IN, HORIZON
from .vol import EWMA_LAMBDA, ewma_hday_var  # noqa: F401  (re-exported: the labels use the same EWMA)

QUANTILES = (0.1, 0.5, 0.9)


def fit_garch(returns: pd.Series) -> dict:
    """Fit a zero-mean GARCH(1,1) with Student-t innovations. Returns params in DECIMAL units.

    GARCH(1,1):  s2[t+1] = omega + alpha * r[t]^2 + beta * s2[t]
    i.e. tomorrow's variance = a floor + a reaction to today's shock + memory of yesterday's variance.
    The `arch` library works best with returns in percent, hence the *100 in and the /1e4 out
    (omega has units of return^2, so percent^2 -> decimal^2 divides by 100^2).
    """
    from arch import arch_model

    res = arch_model(returns.dropna() * 100, mean="Zero", vol="GARCH", p=1, q=1, dist="t").fit(disp="off")
    p = res.params
    out = {
        "omega": float(p["omega"]) / 1e4,
        "alpha": float(p["alpha[1]"]),
        "beta": float(p["beta[1]"]),
        "nu": float(p["nu"]),
    }
    # alpha + beta >= 1 means variance never mean-reverts and the closed form below breaks.
    if out["alpha"] + out["beta"] >= 1:
        raise ValueError(f"non-stationary GARCH fit: alpha+beta={out['alpha'] + out['beta']:.4f}")
    return out


def garch_next_var(r: np.ndarray, omega: float, alpha: float, beta: float) -> np.ndarray:
    """s2[t] = forecast variance of the NEXT day's return, given returns up to and including day t."""
    prev = omega / (1 - alpha - beta)  # start the recursion at the long-run variance
    s2 = np.empty(len(r))
    for t in range(len(r)):
        x = 0.0 if np.isnan(r[t]) else r[t]  # a missing return contributes no shock
        prev = omega + alpha * x * x + beta * prev
        s2[t] = prev
    return s2


def garch_hday_var(s2_next: np.ndarray, omega: float, alpha: float, beta: float, h: int = HORIZON) -> np.ndarray:
    """Total variance over the next h days = sum of E[s2_{t+k}] for k = 1..h.

    Expected variance decays geometrically toward the long-run level v = omega / (1 - alpha - beta):
        E[s2_{t+k}] = v + (alpha + beta)^(k-1) * (s2_next - v)
    Summing that geometric series gives the closed form below (no loop, easy to port to TypeScript).
    This is NOT sqrt(h) * today's vol: after a spike, vol is expected to fade, and the sum reflects it.
    """
    persist = alpha + beta
    v = omega / (1 - persist)
    return h * v + (s2_next - v) * (1 - persist**h) / (1 - persist)


def standardized_quantiles(fwd: np.ndarray, hvar: np.ndarray) -> dict:
    """z-quantiles of (realised H-day return / forecast spread). Estimated on TRAINING rows only."""
    z = fwd / np.sqrt(hvar)
    z = z[np.isfinite(z)]
    return {f"q{int(q * 100)}": float(np.quantile(z, q)) for q in QUANTILES}


def band_returns(hvar: np.ndarray, q: dict) -> dict:
    """Band edges as log returns: sqrt(variance) * z. Price band = spot * exp(this)."""
    s = np.sqrt(hvar)
    return {k: s * v for k, v in q.items()}


def pinball(y: np.ndarray, pred: np.ndarray, tau: float) -> float:
    """Quantile ("pinball") loss: penalises under-prediction by tau and over-prediction by 1 - tau.
    Lower is better; it is minimised exactly when `pred` is the true tau-quantile."""
    e = y - pred
    return float(np.mean(np.maximum(tau * e, (tau - 1) * e)))


def evaluate(fwd: np.ndarray, bands: dict) -> dict:
    """Coverage of the P10-P90 interval (ideal 0.80) and mean pinball loss across the 3 quantiles."""
    m = np.isfinite(fwd)
    y = fwd[m]
    cov = float(np.mean((y >= bands["q10"][m]) & (y <= bands["q90"][m])))
    loss = float(np.mean([pinball(y, bands[f"q{int(t * 100)}"][m], t) for t in QUANTILES]))
    return {"coverage_p10_p90": cov, "pinball": loss}


def _returns_and_forward(raw: pd.DataFrame) -> tuple[pd.Series, np.ndarray]:
    g = raw["xau"]
    return np.log(g / g.shift(1)), np.log(g.shift(-HORIZON) / g).to_numpy()


def _fit_all(r: pd.Series, fwd: np.ndarray, upto: int) -> dict:
    """Fit everything using ONLY rows [0, upto): GARCH params, then the standardized quantiles.
    (The variance recursion is still run over all rows afterwards - it only looks backwards.)"""
    gp = fit_garch(r.iloc[:upto])
    s2 = garch_next_var(r.to_numpy(), gp["omega"], gp["alpha"], gp["beta"])
    hv_g = garch_hday_var(s2, gp["omega"], gp["alpha"], gp["beta"])
    hv_e = ewma_hday_var(r.to_numpy())
    win = slice(BURN_IN, upto)
    return {
        "garch": gp, "s2": s2, "hv_g": hv_g, "hv_e": hv_e,
        "qg": standardized_quantiles(fwd[win], hv_g[win]),
        "qe": standardized_quantiles(fwd[win], hv_e[win]),
        # baseline "no volatility model": the same quantiles for every day, from all training returns
        "qc": {f"q{int(q * 100)}": float(np.nanquantile(fwd[win], q)) for q in QUANTILES},
    }


def evaluate_test_window(raw: pd.DataFrame, test_rows: int = 252) -> dict:
    """Fit on data BEFORE the test window, then score the bands on the test window.

    A purge gap of HORIZON rows separates them: the last training label looks HORIZON days ahead,
    so without the gap its outcome would overlap the first test days (a subtle leak).
    Returns per-row bands (for charts) and the summary report.
    """
    r, fwd = _returns_and_forward(raw)
    n = len(raw)
    ev = _fit_all(r, fwd, n - test_rows - HORIZON)
    t = slice(n - test_rows, n)
    const = {k: np.full(n, v) for k, v in ev["qc"].items()}
    per_row = {
        "garch": {k: v[t] for k, v in band_returns(ev["hv_g"], ev["qg"]).items()},
        "ewma": {k: v[t] for k, v in band_returns(ev["hv_e"], ev["qe"]).items()},
        "constant": {k: v[t] for k, v in const.items()},
    }
    report = {"test_rows": test_rows, **{name: evaluate(fwd[t], b) for name, b in per_row.items()}}
    # Keep the old key name used by model_meta.json readers.
    report["constant_vol_baseline"] = report.pop("constant")
    return {
        "dates": raw.index[t],
        "spot": raw["xau"].to_numpy()[t],
        "fwd": fwd[t],
        "bands": per_row,  # log-return edges per method: price edge = spot * exp(edge)
        "report": report,
    }


def run(raw: pd.DataFrame, test_rows: int = 252) -> tuple[dict, dict]:
    """Return (production_params, test_report). Production params are refit on ALL rows."""
    r, fwd = _returns_and_forward(raw)
    report = evaluate_test_window(raw, test_rows)["report"]
    prod = _fit_all(r, fwd, len(raw))
    params = {
        "horizon": HORIZON,
        "garch": prod["garch"],
        "ewma_lambda": EWMA_LAMBDA,
        "quantiles_garch": prod["qg"],
        "quantiles_ewma": prod["qe"],
        # the app recomputes the recursion from raw closes; this is the parity check value
        "state": {
            "asof": str(raw.index[-1].date()),
            "garch_next_var": float(prod["s2"][-1]),
            "garch_hday_var": float(prod["hv_g"][-1]),
        },
    }
    return params, report
