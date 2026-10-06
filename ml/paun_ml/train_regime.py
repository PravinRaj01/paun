"""Model A: CatBoost regime classifier - train, evaluate honestly, export to ONNX.

WHAT    Given today's features, output three probabilities for the next 5 sessions:
        Bearish Retracement (fall > k*sigma), Sideways Consolidation (inside), Bullish Breakout (rise > k*sigma),
        where sigma = today's expected 5-session volatility and k = 0.75 (volatility-scaled labels, features.py).
WHY     Gradient-boosted trees (CatBoost) are the strongest, most stable choice for small noisy
        tabular data like this (~4,000 daily rows). The model is tiny and exports to ONNX so the
        browser can run it with no server.
HOW     0. model_config.json decides the features / hyper-parameters / shrinkage (chosen by experiments.py)
        1. load_dataset      download + build features/labels
        2. walk_forward_cv   5 expanding-window folds, each tested on the future of its training data
        3. holdout_test      train on everything before the final year, score on that untouched year
        4. train_production  refit on ALL rows with the same fixed settings -> the shipped model
        5. export_onnx       write regime.onnx and PROVE it reproduces CatBoost's probabilities
        The notebook (colab.ipynb) calls these steps one by one; main() chains them for CLI/CI use.
RUN     from ml/:   python -m paun_ml.train_regime            (needs internet)
SUCCESS The bar is deliberately modest: beat the *climatology* baseline (always predict the
        historical class frequencies). See evaluate.acceptance() for the exact ship/no-ship rules.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from catboost import CatBoostClassifier
from sklearn.metrics import accuracy_score, f1_score, log_loss
from sklearn.model_selection import TimeSeriesSplit

from . import bands as bands_mod
from . import evaluate as ev
from .data import build_raw
from .constants import HORIZON
from .features import ALL_FEATURES, CLASS_NAMES, compute_features, compute_labels, feature_spec, training_frame
from .model_config import DEFAULT_PARAMS, catboost_params, load_config

# Fixed hyper-parameters on purpose: small data + many knobs = easy to overfit by tuning. Shallow trees
# (depth 4), strong L2 and a slow learning rate keep the model humble. Because iterations are fixed we do
# NOT use early stopping on the validation fold (that would tune the model on the very data we score).
PARAMS = DEFAULT_PARAMS  # same dict object: tests shrink `iterations` through it
PROB_COLS = ["p0", "p1", "p2"]  # P(bearish), P(sideways), P(bullish)


def class_prior(y) -> np.ndarray:
    """Climatology: how often each class occurred in the training data. The baseline to beat."""
    return np.bincount(np.asarray(y, dtype=int), minlength=3) / len(y)


def metrics(y: np.ndarray, p: np.ndarray, prior: np.ndarray) -> dict:
    """Score probabilities against outcomes.

    logloss        penalises confident wrong answers heavily; lower is better. THE main metric here.
    logloss_prior  same score for the baseline that always answers `prior`; model must beat this.
    brier          mean squared error of the probabilities (0 = perfect, lower is better).
    accuracy / macro_f1  for intuition only - accuracy flatters a model that always says "sideways".
    """
    pred = p.argmax(1)
    onehot = np.eye(3)[y.astype(int)]
    prior_p = np.vstack([prior] * len(y))
    m = {
        "logloss": float(log_loss(y, p, labels=[0, 1, 2])),
        "logloss_prior": float(log_loss(y, prior_p, labels=[0, 1, 2])),
        "brier": float(np.mean(np.sum((p - onehot) ** 2, axis=1))),
        "accuracy": float(accuracy_score(y, pred)),
        "macro_f1": float(f1_score(y, pred, average="macro")),
    }
    m["beats_prior"] = m["logloss"] < m["logloss_prior"]
    return m


def _fit(X, y, params: dict | None = None) -> CatBoostClassifier:
    m = CatBoostClassifier(**(params or PARAMS))
    m.fit(X, y.astype(int))
    return m


def catboost_fit_predict(params: dict | None = None, shrink_w: float = 1.0):
    """Build a `fit_predict(X_tr, y_tr, X_va) -> probabilities` function.

    Experiments swap this function to compare candidates under the SAME walk-forward folds.
    `shrink_w` < 1 blends the model with climatology: p = w * p_model + (1 - w) * prior (prior from X_tr only).
    """
    def fit_predict(X_tr, y_tr, X_va):
        p = _fit(X_tr, y_tr, params).predict_proba(X_va)
        return p if shrink_w >= 1.0 else shrink_w * p + (1 - shrink_w) * class_prior(y_tr)
    return fit_predict


def _prob_frame(index, p, y, prior) -> pd.DataFrame:
    """Predictions + outcomes + baseline probabilities in one table (used for charts)."""
    df = pd.DataFrame(p, index=index, columns=PROB_COLS)
    df["y"] = np.asarray(y, dtype=int)
    for k in range(3):
        df[f"q{k}"] = prior[k]
    return df


SHRINK_GRID = np.linspace(0, 1, 21)


def fit_shrink_w(X, y, params: dict | None = None, inner_frac: float = 0.8) -> float:
    """Choose how much to trust the model vs climatology: p = w * p_model + (1 - w) * prior.

    Why: with weak signal a tree model is overconfident (it learned noise). Blending with the base rates is the
    standard cure, and the weight is learned, not guessed. It is fitted on an INNER split of the training rows
    only: fit on the first 80% (minus the purge gap), pick the w that minimises log-loss on the last 20%.
    The outer validation rows are never involved, so there is no tuning on the data we score.
    """
    n = len(X)
    n_in = int(inner_frac * n)
    Xi, yi = X.iloc[: n_in - HORIZON], y.iloc[: n_in - HORIZON]
    Xv, yv = X.iloc[n_in:], y.iloc[n_in:]
    p_model = _fit(Xi, yi, params).predict_proba(Xv)
    prior = class_prior(yi)
    losses = [log_loss(yv, w * p_model + (1 - w) * prior, labels=[0, 1, 2]) for w in SHRINK_GRID]
    return float(SHRINK_GRID[int(np.argmin(losses))])


def shrink_fit_predict(params: dict | None = None, record: list | None = None):
    """fit_predict that learns its own shrinkage weight inside each training set (see fit_shrink_w)."""
    def fit_predict(X_tr, y_tr, X_va):
        w = fit_shrink_w(X_tr, y_tr, params)
        if record is not None:
            record.append(w)
        return w * _fit(X_tr, y_tr, params).predict_proba(X_va) + (1 - w) * class_prior(y_tr)
    return fit_predict


# --------------------------------------------------------------------------- 1. data
def load_dataset(start: str = "2010-01-01", cache: Path | None = None, use_cache: bool = False,
                 features: list[str] | None = None):
    """Return (raw, df, X, y). `cache` lets you skip re-downloading while iterating in a notebook.

    X holds `features` (default: the production list from model_config.json); df holds ALL candidate
    features plus the label columns, so experiments can slice any subset.
    """
    if use_cache and cache is not None and cache.exists():
        raw = pd.read_csv(cache, index_col=0, parse_dates=True)
    else:
        raw = build_raw(start)
        if cache is not None:
            cache.parent.mkdir(parents=True, exist_ok=True)
            raw.to_csv(cache)
    df = training_frame(raw)  # only rows with complete features AND a known outcome
    return raw, df, df[features or load_config()["features"]], df["regime"].astype(int)


def split_sizes(n_rows: int, n_test: int) -> int:
    """Number of rows available for training/CV. Layout (oldest -> newest):

        [ train + CV ........ ][ gap = HORIZON rows ][ final test year ]

    The gap exists because each label looks HORIZON sessions into the future: the last training
    label's outcome would otherwise overlap the first test days, quietly leaking information.
    """
    return n_rows - n_test - HORIZON


# --------------------------------------------------------------------------- 2. cross-validation
def walk_forward_cv(X, y, n_tr: int, n_splits: int = 5, fit_predict=None):
    """Expanding-window CV that respects time: always train on the past, validate on the future.

    Ordinary shuffled K-fold would train on 2024 to "predict" 2019 - impossible in real life and
    wildly optimistic. `gap=HORIZON` again removes label overlap between train and validation.
    Returns (per-fold metrics, out-of-fold predictions for every validation row).
    `fit_predict` defaults to the plain CatBoost model (see catboost_fit_predict).
    """
    fit_predict = fit_predict or catboost_fit_predict()
    folds, oof = [], []
    for i, (tr, va) in enumerate(TimeSeriesSplit(n_splits=n_splits, gap=HORIZON).split(X.iloc[:n_tr])):
        prior = class_prior(y.iloc[tr])
        p = fit_predict(X.iloc[tr], y.iloc[tr], X.iloc[va])
        folds.append({
            "fold": i, "train_rows": len(tr),
            "val_start": str(X.index[va[0]].date()), "val_end": str(X.index[va[-1]].date()),
            **metrics(y.iloc[va].to_numpy(), p, prior),
        })
        part = _prob_frame(X.index[va], p, y.iloc[va], prior)
        part["fold"] = i
        oof.append(part)
    return folds, pd.concat(oof)


# --------------------------------------------------------------------------- 3. final held-out year
def holdout_test(X, y, n_tr: int, n_test: int, fit_predict=None):
    """Train on the first n_tr rows, score on the last n_test rows (never used for any decision)."""
    fit_predict = fit_predict or catboost_fit_predict()
    prior = class_prior(y.iloc[:n_tr])
    Xt, yt = X.iloc[-n_test:], y.iloc[-n_test:]
    p = fit_predict(X.iloc[:n_tr], y.iloc[:n_tr], Xt)
    return metrics(yt.to_numpy(), p, prior), _prob_frame(Xt.index, p, yt, prior), None


# --------------------------------------------------------------------------- 4. production model
def train_production(X, y, params: dict | None = None) -> CatBoostClassifier:
    """The shipped model: all labelled data, same fixed hyper-parameters that were validated above."""
    return _fit(X, y, params)


# --------------------------------------------------------------------------- 5. ONNX export
def strip_zipmap(path: Path) -> bool:
    """CatBoost's ONNX ends in a ZipMap node that turns the probabilities into a list of
    {class: probability} dictionaries. onnxruntime-web cannot hand such a type to JavaScript, so we
    remove that node and expose the plain float tensor [N, 3] under the same output name."""
    import onnx
    from onnx import TensorProto, helper

    m = onnx.load(str(path))
    zips = [n for n in m.graph.node if n.op_type == "ZipMap"]
    if not zips:
        return False
    z = zips[0]
    raw_name, out_name = z.input[0], z.output[0]
    m.graph.node.remove(z)
    for n in m.graph.node:  # the classifier now emits the public output name directly
        for i, o in enumerate(n.output):
            if o == raw_name:
                n.output[i] = out_name
    for o in [o for o in m.graph.output if o.name == out_name]:
        m.graph.output.remove(o)
    m.graph.output.append(helper.make_tensor_value_info(out_name, TensorProto.FLOAT, ["N", len(CLASS_NAMES)]))
    onnx.checker.check_model(m)
    onnx.save(m, str(path))
    return True


def export_onnx(model: CatBoostClassifier, out_dir: Path, X_check, fallback_dir: Path | None = None) -> dict:
    """Write regime.onnx, then prove it matches CatBoost on real rows. Prints the I/O signature.

    Input  `features` float32 [N, n_features] in the model_config.json feature order (X_check.columns).
    Output `probabilities` float32 [N, 3].
    """
    import onnxruntime as ort

    out_dir.mkdir(parents=True, exist_ok=True)
    onnx_path = out_dir / "regime.onnx"
    model.save_model(
        str(onnx_path),
        format="onnx",
        export_parameters={
            "onnx_domain": "ai.catboost",
            "onnx_model_version": 1,
            "onnx_graph_name": "PaunRegime",
            "onnx_doc_string": f"features={list(X_check.columns)}",
        },
    )
    stripped = strip_zipmap(onnx_path)
    if fallback_dir is not None:  # kept out of public/: only needed if onnxruntime-web ever fails
        fallback_dir.mkdir(parents=True, exist_ok=True)
        model.save_model(str(fallback_dir / "regime.json"), format="json")

    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    sig = {
        "inputs": [{"name": i.name, "shape": i.shape, "type": i.type} for i in sess.get_inputs()],
        "outputs": [{"name": o.name, "shape": o.shape, "type": o.type} for o in sess.get_outputs()],
    }
    print("ONNX signature:", json.dumps(sig, indent=2))

    x = X_check.to_numpy(dtype=np.float32)  # the browser feeds float32, so test with float32
    outs = sess.run(None, {sess.get_inputs()[0].name: x})
    names = [o.name for o in sess.get_outputs()]
    raw_p = outs[[i for i, n in enumerate(names) if "prob" in n.lower()][0]]
    assert not isinstance(raw_p, list), "ZipMap still present: ort-web could not read probabilities"
    p_onnx = np.asarray(raw_p)
    assert p_onnx.shape == (len(x), len(CLASS_NAMES)), p_onnx.shape
    diff = np.abs(p_onnx - model.predict_proba(X_check))
    bad = float(np.mean(diff.max(axis=1) > 1e-3))
    print(f"ONNX vs CatBoost: max|diff|={diff.max():.2e}, rows off by >1e-3: {bad:.2%}, zipmap_stripped={stripped}")
    assert bad < 0.005, "ONNX probabilities disagree with CatBoost"
    return {**sig, "max_abs_diff": float(diff.max()), "zipmap_stripped": stripped}


# --------------------------------------------------------------------------- CLI / CI entry point
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--start", default="2010-01-01")
    ap.add_argument("--test-rows", type=int, default=252, help="size of the final held-out window (~1 trading year)")
    ap.add_argument("--artifacts", default="artifacts", help="scratch dir (raw data cache, JSON fallback)")
    ap.add_argument("--models-dir", default="../public/models", help="where the app-served model files go")
    ap.add_argument("--native-dir", default="models", help="where the native CatBoost model (for SHAP) is kept")
    ap.add_argument("--reports-dir", default="reports", help="evaluation report + charts")
    ap.add_argument("--use-cache", action="store_true", help="reuse artifacts/raw.csv instead of downloading")
    a = ap.parse_args()
    art, models = Path(a.artifacts), Path(a.models_dir)

    cfg = load_config()  # chosen by experiments.py; defaults to the original 18 features
    features, params, w = cfg["features"], catboost_params(cfg), cfg["shrink_w"]
    print(f"config: candidate={cfg['candidate']} features={len(features)} shrink_w={w}")
    raw, df, X, y = load_dataset(a.start, art / "raw.csv", a.use_cache, features)
    mix = y.value_counts(normalize=True).sort_index().round(3).to_dict()
    print(f"{len(df)} labelled rows {df.index[0].date()} -> {df.index[-1].date()}; class mix {mix}")

    n_test = a.test_rows
    n_tr = split_sizes(len(df), n_test)
    # "inner" shrinkage re-fits its weight inside every training set, so CV/test numbers stay honest.
    fit_predict = shrink_fit_predict(params) if cfg["shrink_mode"] == "inner" else catboost_fit_predict(params)
    folds, oof = walk_forward_cv(X, y, n_tr, fit_predict=fit_predict)
    for f in folds:
        print(f"fold {f['fold']}: logloss {f['logloss']:.4f} vs prior {f['logloss_prior']:.4f}")
    test_m, test_df, _ = holdout_test(X, y, n_tr, n_test, fit_predict)
    print(f"TEST (last {n_test} rows):", test_m)

    prod = train_production(X, y, params)
    Path(a.native_dir).mkdir(parents=True, exist_ok=True)
    prod.save_model(str(Path(a.native_dir) / "regime.cbm"))  # native model: snapshot job computes SHAP drivers
    export = export_onnx(prod, models, X.iloc[-n_test:], art)
    imp = dict(sorted(zip(features, map(float, prod.get_feature_importance())), key=lambda kv: -kv[1]))

    params_b, band_report = bands_mod.run(raw, n_test)
    (models / "bands_params.json").write_text(json.dumps(params_b, indent=2))

    ctx = {
        "raw": raw, "df": df, "y": y, "X": X, "features": features, "labels": compute_labels(raw), "folds": folds,
        "oof": oof, "test_m": test_m, "test_df": test_df, "imp": imp, "model": prod,
        "band_eval": bands_mod.evaluate_test_window(raw, n_test), "export": export, "n_test": n_test, "n_tr": n_tr,
        "params": params, "cfg": cfg, "bands_params": params_b,
        "live_row": compute_features(raw)[features].iloc[[-1]],  # today's inputs (newest session, unlabelled)
    }
    verdict = ev.write_report(Path(a.reports_dir), ctx)
    print("VERDICT:", json.dumps(verdict["summary"], indent=2))

    meta = {
        "version": 2,
        "trained_through": str(df.index[-1].date()),
        "rows": len(df),
        "spec": feature_spec(features),
        "classes": CLASS_NAMES,
        "candidate": cfg["candidate"],
        "catboost_params": params,
        # app applies  p = w * p_onnx + (1 - w) * prior  (w = 1 means no shrinkage)
        "shrink": {"w": w, "prior": [float(v) for v in class_prior(y)]},
        "cv_folds": folds,
        "test": test_m,
        "bands_test": band_report,
        "feature_importance": imp,
        "onnx": export,
        "acceptance": verdict["summary"],  # the app reads this to decide whether to show regime %
    }
    models.mkdir(parents=True, exist_ok=True)
    (models / "model_meta.json").write_text(json.dumps(meta, indent=2))
    print("wrote", models, "and", a.reports_dir)


if __name__ == "__main__":
    main()
