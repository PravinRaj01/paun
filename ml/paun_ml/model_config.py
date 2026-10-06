"""The chosen Model A configuration (written by experiments.py, read by train_regime / snapshot / evaluate).

Why a file: the experiments decide WHICH features, hyper-parameters and shrinkage to ship. Storing the decision
in JSON (committed to git) makes the shipped model reproducible and keeps the choice out of code edits.
"""
from __future__ import annotations

import json
from pathlib import Path

from .features import BASE_FEATURES

CONFIG_PATH = Path(__file__).with_name("model_config.json")

DEFAULT_PARAMS = dict(
    loss_function="MultiClass", iterations=300, learning_rate=0.03, depth=4, l2_leaf_reg=10,
    random_seed=42, verbose=0, allow_writing_files=False,
)
DEFAULT_CONFIG = {
    "candidate": "C1",
    "features": list(BASE_FEATURES),
    "params": {k: v for k, v in DEFAULT_PARAMS.items() if k not in ("verbose", "allow_writing_files")},
    "shrink_mode": "none",  # "none" | "inner": blend with climatology, weight learned on an inner split
    "shrink_w": 1.0,  # production weight: shipped p = w * p_model + (1 - w) * prior; 1.0 = no shrinkage
    "qualified": None,  # did the experiments' winner meet the selection rule? (None = not run yet)
}


def load_config(path: Path = CONFIG_PATH) -> dict:
    cfg = json.loads(path.read_text()) if path.exists() else {}
    return {**DEFAULT_CONFIG, **cfg}


def save_config(cfg: dict, path: Path = CONFIG_PATH) -> None:
    path.write_text(json.dumps(cfg, indent=2))


def catboost_params(cfg: dict) -> dict:
    return {**DEFAULT_PARAMS, **cfg["params"]}
