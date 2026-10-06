"""Experiments to improve Model A - run under one pre-registered protocol so we cannot fool ourselves.

PROTOCOL (fixed before looking at results)
    * Candidates are compared ONLY on the 5 walk-forward folds. The held-out year is opened once, later, for the
      winner (train_regime.py). Note: we already looked at that year with the older fixed-threshold labels.
    * Selection rule: among candidates that beat climatology in >= 3 of 5 folds, take the highest mean log-loss
      improvement; candidates within 0.002 of the best are treated as tied and the SIMPLER one wins
      (fewer features, then no shrinkage, then shallower trees).
    * Every candidate reports a block-bootstrap 90% interval for its mean improvement. If the interval contains 0
      the candidate is statistically indistinguishable from climatology, whatever its point estimate says.

CANDIDATES (IDs follow PLAN.md; C5 is evaluated before C4 because C4 builds on its result)
    C0  climatology (always predict the historical class mix)  - the reference, improvement = 0 by definition
    C1  CatBoost, original 18 features
    C2  CatBoost, 18 + volatility-normalised features (24)
    C3  best of C1/C2 after dropping feature groups whose removal helps (ablation)
    C5  small regularisation grid (depth x l2) on the C3 features
    C4  best of the above, blended with climatology; blend weight learned on an inner split (never on validation rows)

RUN     from ml/:  python -m paun_ml.experiments --use-cache
OUTPUT  reports/experiments.md, reports/figures/experiments.png, paun_ml/model_config.json
"""
from __future__ import annotations

import argparse
import itertools
from pathlib import Path

import numpy as np
import pandas as pd

from . import evaluate as ev
from . import train_regime as tr
from .features import ALL_FEATURES, BASE_FEATURES, FEATURE_GROUPS
from .model_config import DEFAULT_CONFIG, DEFAULT_PARAMS, save_config

TIE_TOLERANCE = 0.002  # mean log-loss differences smaller than this are treated as ties
MIN_ABLATION_GAIN = 0.0005  # a group is dropped only if removing it helps by at least this much
MIN_FOLDS = 3
GRID = {"depth": [2, 3, 4], "l2_leaf_reg": [10, 30]}
BLOCK = 20  # bootstrap block length: consecutive days are correlated, so resample blocks, not single rows


def _record(cid: str, label: str, X_all, y, n_tr, feats: list[str], params: dict, shrink: bool, folds_cache: dict) -> dict:
    """Run one candidate through the walk-forward folds and summarise it."""
    record: list[float] = []  # shrinkage weights learned per fold (only filled when shrink=True)
    fp = tr.shrink_fit_predict(params, record) if shrink else tr.catboost_fit_predict(params)
    folds, oof = tr.walk_forward_cv(X_all[feats], y, n_tr, fit_predict=fp)
    gains = [f["logloss_prior"] - f["logloss"] for f in folds]
    m, b = ev._row_losses(oof)
    lo, hi = ev.block_bootstrap_ci((b - m).to_numpy(), BLOCK)
    rec = {
        "id": cid, "label": label, "features": feats, "params": params, "shrink": shrink,
        "n_features": len(feats), "gains": gains, "mean_gain": float(np.mean(gains)),
        "folds_beating": int(sum(g > 0 for g in gains)), "ci_low": lo, "ci_high": hi,
        "ece": ev.ece(oof["y"].to_numpy(), oof[tr.PROB_COLS].to_numpy()),
        "shrink_ws": list(record) if shrink else None,
    }
    folds_cache[cid] = (folds, oof)
    return rec


def _simplicity(c: dict):
    """Lower sorts first = simpler: fewer features, no shrinkage, shallower trees."""
    return (c["n_features"], c["shrink"], c["params"].get("depth", 4))


def select_winner(cands: list[dict]) -> tuple[dict, bool]:
    """Apply the pre-registered selection rule. Returns (winner, qualified).

    If nothing reaches MIN_FOLDS, the best candidate by mean improvement is returned with qualified=False
    (we still need a configuration for the report, but it must not be presented as passing).
    """
    pool = [c for c in cands if c["folds_beating"] >= MIN_FOLDS]
    qualified = bool(pool)
    pool = pool or cands
    best = max(c["mean_gain"] for c in pool)
    tied = [c for c in pool if best - c["mean_gain"] <= TIE_TOLERANCE]
    return min(tied, key=_simplicity), qualified


def run_experiments(X_all, y, n_tr: int, params: dict | None = None, grid: dict | None = None, log=print) -> dict:
    """Run C1..C5 on the walk-forward folds of the first `n_tr` rows."""
    base_params = {**{k: v for k, v in DEFAULT_PARAMS.items()}, **(params or {})}
    grid = grid or GRID
    cache: dict = {}
    cands: list[dict] = []

    def run(cid, label, feats, p, shrink=False):
        rec = _record(cid, label, X_all, y, n_tr, feats, p, shrink, cache)
        log(f"  {cid:<3} {label:<38} mean gain {rec['mean_gain']:+.4f}  beats {rec['folds_beating']}/5  "
            f"90% CI [{rec['ci_low']:+.4f}, {rec['ci_high']:+.4f}]")
        return rec

    log("C1 / C2 - feature sets")
    c1 = run("C1", "CatBoost, original 18 features", list(BASE_FEATURES), base_params)
    c2 = run("C2", "CatBoost, + volatility-normalised (24)", list(ALL_FEATURES), base_params)
    cands += [c1, c2]
    start = c1 if c1["mean_gain"] >= c2["mean_gain"] else c2

    log("C3 - feature-group ablation")
    ablation = []
    for g, cols in FEATURE_GROUPS.items():
        kept = [f for f in start["features"] if f not in cols]
        if len(kept) == len(start["features"]) or not kept:
            continue
        rec = _record(f"abl_{g}", f"without {g}", X_all, y, n_tr, kept, base_params, False, cache)
        ablation.append({"group": g, "removed": len(start["features"]) - len(kept), "mean_gain": rec["mean_gain"],
                         "delta": rec["mean_gain"] - start["mean_gain"], "folds_beating": rec["folds_beating"]})
    drop = [a["group"] for a in ablation if a["delta"] >= MIN_ABLATION_GAIN]
    kept = [f for f in start["features"] if not any(f in FEATURE_GROUPS[g] for g in drop)]
    log(f"  groups dropped: {drop or 'none'}")
    c3 = run("C3", f"best set, minus {', '.join(drop) or 'nothing'}", kept, base_params)
    cands.append(c3)

    log("C5 - regularisation grid on C3 features")
    grid_recs = []
    for depth, l2 in itertools.product(grid["depth"], grid["l2_leaf_reg"]):
        p = {**base_params, "depth": depth, "l2_leaf_reg": l2}
        grid_recs.append(_record(f"g_d{depth}_l{l2}", f"depth {depth}, l2 {l2}", X_all, y, n_tr, c3["features"], p, False, cache))
    best_cell = max(grid_recs, key=lambda r: r["mean_gain"])
    c5 = {**best_cell, "id": "C5", "label": f"C3 features, {best_cell['label']} (best of {len(grid_recs)})"}
    cache["C5"] = cache[best_cell["id"]]
    log(f"  C5  {c5['label']:<38} mean gain {c5['mean_gain']:+.4f}  beats {c5['folds_beating']}/5")
    cands.append(c5)

    log("C4 - best so far, shrunk toward climatology")
    best_before = max([c1, c2, c3, c5], key=lambda c: c["mean_gain"])
    c4 = run("C4", f"{best_before['id']} + shrink to climatology", best_before["features"], best_before["params"], shrink=True)
    cands.append(c4)

    winner, qualified = select_winner(cands)
    log(f"WINNER {winner['id']} ({winner['label']}) - qualified under the rule: {qualified}")
    return {"candidates": sorted(cands, key=lambda c: c["id"]), "ablation": ablation, "grid": grid_recs,
            "winner": winner, "qualified": qualified, "start_set": start["id"], "cache": cache}


def fig_experiments(cands: list[dict], winner_id: str):
    """Mean improvement over climatology per candidate, with its 90% interval. Right of zero = better."""
    cs = [{"id": "C0", "label": "Climatology (reference)", "mean_gain": 0.0, "ci_low": 0.0, "ci_high": 0.0,
           "folds_beating": None}] + cands
    fig, ax = ev._fig(9, 0.55 * len(cs) + 1.6)
    ax.grid(axis="y", visible=False)
    ax.grid(axis="x", color=ev.GRID, linewidth=0.6)
    ys = np.arange(len(cs))[::-1]
    for y_, c in zip(ys, cs):
        ax.plot([c["ci_low"], c["ci_high"]], [y_, y_], color=ev.BLUE, lw=2, solid_capstyle="round", alpha=0.45)
        ax.plot(c["mean_gain"], y_, "o", color=ev.BLUE, ms=7, markeredgecolor=ev.SURFACE, markeredgewidth=1.5)
        tag = "" if c["folds_beating"] is None else f"  {c['folds_beating']}/5 folds"
        star = "  <- chosen" if c["id"] == winner_id else ""
        ax.text(ax.get_xlim()[1], y_, f"{tag}{star}", va="center", fontsize=8, color=ev.INK2)
    ax.axvline(0, color=ev.AXIS, lw=1)
    ax.set_yticks(ys, [f"{c['id']}  {c['label']}" for c in cs], fontsize=8.5, color=ev.INK2)
    ax.set_xlabel("mean log-loss improvement over climatology (right = better); bar = 90% interval", color=ev.MUTED, fontsize=8)
    ev._title(ax, "Does anything beat 'always predict the base rates'?",
              "Walk-forward folds only. An interval that includes 0 means the gain could be luck")
    return fig


def write_experiments_report(out_dir: Path, res: dict) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "figures").mkdir(exist_ok=True)
    fig = fig_experiments(res["candidates"], res["winner"]["id"])
    fig.savefig(out_dir / "figures" / "experiments.png", dpi=140, facecolor=ev.SURFACE)
    ev.plt.close(fig)
    w = res["winner"]
    sig = "its 90% interval excludes 0" if w["ci_low"] > 0 else "its 90% interval INCLUDES 0 - the gain is not distinguishable from luck"
    lines = [
        "# Model A experiments (walk-forward folds only)",
        "Protocol: candidates compared on the 5 walk-forward folds; the held-out year is opened once, for the winner.",
        f"Rule: needs >= {MIN_FOLDS}/5 folds beating climatology, then highest mean improvement, ties within "
        f"{TIE_TOLERANCE} go to the simpler candidate.\n",
        "## Result",
        f"**Chosen: {w['id']} - {w['label']}** · beats climatology in {w['folds_beating']}/5 folds · mean improvement "
        f"{w['mean_gain']:+.4f} · {sig}.",
        f"**Qualified under the rule: {'yes' if res['qualified'] else 'NO - no candidate reached 3/5 folds'}**\n",
        _table(["ID", "Candidate", "Features", "Folds beating", "Mean gain", "90% interval", "ECE"],
               [[c["id"], c["label"], c["n_features"], f"{c['folds_beating']}/5", f"{c['mean_gain']:+.4f}",
                 f"[{c['ci_low']:+.4f}, {c['ci_high']:+.4f}]", f"{c['ece']:.3f}"] for c in res["candidates"]]),
        "\n![Experiments](figures/experiments.png)\n",
        f"## Feature-group ablation (from {res['start_set']}; removal helps if delta > 0)",
        _table(["Group removed", "Features removed", "Mean gain", "Delta vs full set", "Folds beating"],
               [[a["group"], a["removed"], f"{a['mean_gain']:+.4f}", f"{a['delta']:+.4f}", f"{a['folds_beating']}/5"]
                for a in sorted(res["ablation"], key=lambda a: -a["delta"])]),
        f"\nA group is dropped only if removing it improves the mean by >= {MIN_ABLATION_GAIN}. Groups interact, so "
        "this is a one-pass screen, not proof that a dropped group is useless.\n",
        "## Regularisation grid (C5)",
        _table(["Config", "Mean gain", "Folds beating"],
               [[g["label"], f"{g['mean_gain']:+.4f}", f"{g['folds_beating']}/5"] for g in res["grid"]]),
        "\nSix configurations were tried, so the best one is mildly optimistic (selection bias). That is why the "
        "interval column matters more than the point estimate.\n",
    ]
    ws = next((c["shrink_ws"] for c in res["candidates"] if c["id"] == "C4"), None)
    if ws:
        lines.append(f"C4 shrinkage weights learned per fold (1 = trust model fully, 0 = pure climatology): "
                     f"{[round(v, 2) for v in ws]}")
    (out_dir / "experiments.md").write_text("\n".join(lines), encoding="utf-8")


def _table(headers, rows) -> str:
    return ev._md_table(headers, rows)


def config_from(res: dict, X_all, y) -> dict:
    """Turn the winner into a model_config.json dict (production shrink weight fitted on all labelled rows)."""
    w = res["winner"]
    cfg = {
        **DEFAULT_CONFIG, "candidate": w["id"], "features": w["features"],
        "params": {k: v for k, v in w["params"].items() if k not in ("verbose", "allow_writing_files")},
        "qualified": res["qualified"], "shrink_mode": "inner" if w["shrink"] else "none", "shrink_w": 1.0,
    }
    if w["shrink"]:
        cfg["shrink_w"] = tr.fit_shrink_w(X_all[w["features"]], y, w["params"])
    return cfg


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--start", default="2010-01-01")
    ap.add_argument("--test-rows", type=int, default=252)
    ap.add_argument("--artifacts", default="artifacts")
    ap.add_argument("--reports-dir", default="reports")
    ap.add_argument("--use-cache", action="store_true")
    ap.add_argument("--no-save-config", action="store_true", help="report only; do not overwrite model_config.json")
    a = ap.parse_args()

    raw, df, X_all, y = tr.load_dataset(a.start, Path(a.artifacts) / "raw.csv", a.use_cache, ALL_FEATURES)
    n_tr = tr.split_sizes(len(df), a.test_rows)
    print(f"{len(df)} labelled rows; experiments use the first {n_tr} (held-out year untouched)")
    res = run_experiments(X_all, y, n_tr)
    write_experiments_report(Path(a.reports_dir), res)
    cfg = config_from(res, X_all, y)
    if not a.no_save_config:
        save_config(cfg)
        print("saved paun_ml/model_config.json:", {k: cfg[k] for k in ("candidate", "shrink_mode", "shrink_w", "qualified")})


if __name__ == "__main__":
    main()
