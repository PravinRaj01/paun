"""Daily market snapshot: the single JSON the app fetches (no keys, no CORS issues).

Run from ml/:  python -m paun_ml.snapshot --models-dir ../public/models --out market-snapshot.json
Official regime probabilities come from the SAME regime.onnx the browser runs, so the app can
cross-check its own in-browser inference against `forecast.regime_probs`.
"""
from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import onnxruntime as ort

from . import bands as B
from .data import build_raw
from . import explain
from .constants import LABEL_K
from .features import CLASS_NAMES, HORIZON, compute_features, expected_sigma
from .model_config import load_config

HISTORY_ROWS = 600  # >= 200 (MA200) + enough warm-up for GARCH (persistence ~0.99) so the TS port matches Python
LONG_ROWS = 1300  # ~5 trading years of XAU + USD/MYR for the DCA backtester and the real spot chart


def _round(s, nd=6):  # 6 decimals: the TS port is parity-tested against these values, so do not lose precision
    return [None if v != v else round(float(v), nd) for v in s]


MAX_AGE_DAYS = 6  # a Friday close is ~3 days old on Monday; with a holiday ~4. Older means the data feed stalled.


def check_fresh(as_of: date, today: date, max_age_days: int = MAX_AGE_DAYS) -> int:
    """Refuse to publish a stale snapshot. Returns the age in days, raises if it exceeds max_age_days.

    A silent stale publish is worse than a failed job: the app would show old numbers as if they were current, while a failed
    job leaves the previous snapshot in place and shows up as a red X in GitHub Actions.
    """
    age = (today - as_of).days
    if age > max_age_days:
        raise SystemExit(f"snapshot as-of {as_of} is {age} days old (limit {max_age_days}): the market data feed looks stalled")
    return age


def build_snapshot(models_dir: Path, native_model: Path = Path("models/regime.cbm")) -> dict:
    raw = build_raw("2015-01-01", with_fx_extra=True)
    cfg = load_config()
    features = cfg["features"]  # same list the model was trained on (model_config.json)
    feats = compute_features(raw)[features]
    latest = feats.dropna().iloc[-1]
    asof = latest.name
    sigma = float(expected_sigma(raw).iloc[-1])  # today's expected 5-session move; the 'big move' threshold is k x this

    sess = ort.InferenceSession(str(models_dir / "regime.onnx"), providers=["CPUExecutionProvider"])
    x = latest[features].to_numpy(dtype=np.float32)[None, :]
    probs = np.asarray(sess.run(None, {"features": x})[1])[0]
    w = cfg["shrink_w"] if cfg["shrink_mode"] == "inner" else 1.0  # same blend the app applies after ONNX
    if w < 1.0:
        prior = np.array(json.loads((models_dir / "model_meta.json").read_text())["shrink"]["prior"])
        probs = w * probs + (1 - w) * prior

    # The ship verdict (rules A1-A4) decides whether the app may show regime percentages at all.
    shipped = bool(json.loads((models_dir / "model_meta.json").read_text())["acceptance"]["model_a_ship"])

    drivers = []  # SHAP explanation of today's forecast; needs the native CatBoost model (not shipped to the browser)
    if shipped and native_model.exists():
        from catboost import CatBoostClassifier
        cb = CatBoostClassifier()
        cb.load_model(str(native_model))
        drivers = explain.top_drivers(cb, latest[features].to_frame().T.astype(float), n=3)

    params = json.loads((models_dir / "bands_params.json").read_text())
    g = params["garch"]
    r = np.log(raw["xau"] / raw["xau"].shift(1)).to_numpy()
    s2 = B.garch_next_var(r, g["omega"], g["alpha"], g["beta"])
    hv = B.garch_hday_var(s2, g["omega"], g["alpha"], g["beta"])
    hv_e = B.ewma_hday_var(r, params["ewma_lambda"])
    spot = float(raw["xau"].iloc[-1])
    bands = {
        name: {k: round(spot * float(np.exp(np.sqrt(v[-1]) * z)), 2) for k, z in q.items()}
        for name, v, q in (("garch", hv, params["quantiles_garch"]), ("ewma", hv_e, params["quantiles_ewma"]))
    }

    meta_accept = json.loads((models_dir / "model_meta.json").read_text())["acceptance"]
    h = raw.tail(HISTORY_ROWS)
    long = raw.tail(LONG_ROWS)
    return {
        "schema": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "asOf": str(asof.date()),
        "horizon": HORIZON,
        "spotXauUsd": round(spot, 2),
        "fx": {  # local units per 1 USD, latest close
            "MYR": round(float(raw["usdmyr"].iloc[-1]), 4),
            "SGD": round(float(raw["usdsgd"].iloc[-1]), 4),
            "INR": round(float(raw["usdinr"].iloc[-1]), 4),
            "AED": 3.6725,
        },
        "forecast": {
            "classes": CLASS_NAMES,
            "regime_shipped": shipped,  # False -> UI shows the price bands only
            "regime_probs": [round(float(p), 4) for p in probs] if shipped else None,
            "threshold_pct": round(100 * LABEL_K * sigma, 3),  # "big move" = more than this % in 5 sessions
            "drivers": drivers,
            "features": {k: round(float(latest[k]), 6) for k in features},
            "bands_usd_oz": bands,
            "recommended_band": meta_accept["recommended_band"],  # which band passed rule B1/B2 best
            "garch_hday_var": float(hv[-1]),
        },
        "bandsParams": params,  # GARCH/EWMA parameters + quantiles, so this one JSON is self-contained
        "history": {  # inputs for the TS feature/band port (parity-tested against Python)
            "dates": [str(d.date()) for d in h.index],
            **{c: _round(h[c]) for c in ("xau", "dxy", "us10y", "real10y", "gvz", "oil", "usdmyr", "sp500")},
        },
        "longHistory": {
            "dates": [str(d.date()) for d in long.index],
            "xau": _round(long["xau"], 2),
            "usdmyr": _round(long["usdmyr"], 4),
        },
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models-dir", default="../public/models")
    ap.add_argument("--out", default="market-snapshot.json")
    ap.add_argument("--max-age-days", type=int, default=MAX_AGE_DAYS, help="fail instead of publishing data older than this")
    a = ap.parse_args()
    snap = build_snapshot(Path(a.models_dir))
    check_fresh(date.fromisoformat(snap["asOf"]), datetime.now(timezone.utc).date(), a.max_age_days)
    Path(a.out).write_text(json.dumps(snap, separators=(",", ":")))
    print(f"wrote {a.out} asOf={snap['asOf']} regime_shipped={snap['forecast']['regime_shipped']} bands={snap['forecast']['bands_usd_oz']}")


if __name__ == "__main__":
    main()
