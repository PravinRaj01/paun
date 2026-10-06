"""Shared volatility estimate used by BOTH the labels (features.py) and the price bands (bands.py).

One EWMA, one definition: the "big move" threshold and the band width always agree, and the TypeScript port
needs only one recursion.

EWMA variance:  s2[t] = lam * s2[t-1] + (1 - lam) * r[t]^2       (r = daily log return)
H-day variance: H * s2[t]  (assumes today's volatility persists over the next H sessions)
"""
from __future__ import annotations

import numpy as np

from .constants import HORIZON

EWMA_LAMBDA = 0.94  # RiskMetrics standard: centre of mass ~16 sessions (close to a "20-day" EWMA)
LABEL_VOL_LAMBDA = EWMA_LAMBDA  # set to 1 - 2/21 (~0.905) for a strict span-20 EWMA on the labels


def ewma_hday_var(r: np.ndarray, lam: float = EWMA_LAMBDA, h: int = HORIZON) -> np.ndarray:
    """H-session variance forecast made at each close t, using returns up to and including t.

    The recursion starts from the variance of the first 50 returns; that start-up guess is forgotten after a
    few hundred rows (0.94^200 ~ 4e-6), which is why the first BURN_IN rows are never used for training.
    """
    r = np.asarray(r, dtype=float)
    prev = float(np.nanvar(r[:50])) if len(r) >= 50 else float(np.nanvar(r))
    out = np.empty(len(r))
    for t in range(len(r)):
        x = 0.0 if np.isnan(r[t]) else r[t]  # a missing return contributes no shock
        prev = lam * prev + (1 - lam) * x * x
        out[t] = prev * h
    return out
