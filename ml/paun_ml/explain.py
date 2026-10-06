"""Explainable AI for Model A (and a plain-language explanation of Model B's bands).

WHAT   SHAP values answer "how much did each input push this forecast up or down?". For a tree model they are
       computed EXACTLY (TreeSHAP, built into CatBoost - no extra library). For every row and class:
           raw score of class = baseline + sum over features of SHAP[feature]
           probability        = softmax(raw scores of the three classes)
       so the explanation is not an approximation: it adds up to the model's own output (tests check this).
UNITS  SHAP values are in "log-odds": +0.3 on Bullish means the Bullish odds are multiplied by e^0.3 ~ 1.35
       relative to the other classes, all else equal.
LIMIT  SHAP explains what the MODEL leaned on, not what CAUSED gold to move. A feature can matter to the
       model because it correlates with something else. Treat drivers as "what the model saw", not as news.
USED   * reports/latest.md and the notebook: global drivers, direction of effect, stability across folds,
         a worked example for today's forecast, and why the band is as wide as it is.
       * snapshot.py: `forecast.drivers` = the top contributions to today's dominant class.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from catboost import CatBoostClassifier, Pool

from . import evaluate as ev
from . import train_regime as tr
from .constants import HORIZON
from .features import CLASS_NAMES, FEATURE_DOC


# =============================================================================== maths
def shap_values(model: CatBoostClassifier, X: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """Return (shap [rows, 3 classes, features], baseline [3]) in log-odds units."""
    raw = model.get_feature_importance(Pool(X), type="ShapValues")  # [rows, classes, features + 1]
    return raw[:, :, :-1], raw[0, :, -1]


def _softmax(z: np.ndarray) -> np.ndarray:
    e = np.exp(z - z.max(axis=-1, keepdims=True))
    return e / e.sum(axis=-1, keepdims=True)


def probabilities_from_shap(shap: np.ndarray, baseline: np.ndarray) -> np.ndarray:
    """Rebuild the model's probabilities from its explanation (the additivity check)."""
    return _softmax(shap.sum(axis=2) + baseline)


def global_importance(shap: np.ndarray, features: list[str]) -> pd.DataFrame:
    """Mean |SHAP| per feature (rows) and class (columns): how strongly each input moves each outcome."""
    return pd.DataFrame(np.abs(shap).mean(axis=0).T, index=features, columns=CLASS_NAMES)


def driver_stability(X: pd.DataFrame, y: pd.Series, n_tr: int, params: dict, top: int = 5) -> dict:
    """Do the same inputs matter in every walk-forward fold? Drivers that change every fold are probably noise.

    Fits one model per fold, explains that fold's VALIDATION rows (out of sample), and ranks features by mean |SHAP|.
    Returns {"ranks": features x folds DataFrame of ranks (1 = most important), "overlap": mean Jaccard of the
    top-N sets across fold pairs, 0 = never the same, 1 = always the same}.
    """
    from sklearn.model_selection import TimeSeriesSplit

    from .constants import HORIZON as H

    cols = {}
    for i, (a, b) in enumerate(TimeSeriesSplit(n_splits=5, gap=H).split(X.iloc[:n_tr])):
        m = tr._fit(X.iloc[a], y.iloc[a], params)
        imp = np.abs(shap_values(m, X.iloc[b])[0]).mean(axis=(0, 1))
        cols[f"fold {i + 1}"] = pd.Series(imp, index=X.columns).rank(ascending=False).astype(int)
    ranks = pd.DataFrame(cols)
    tops = [set(ranks.index[ranks[c] <= top]) for c in ranks]
    pairs = [len(a & b) / len(a | b) for i, a in enumerate(tops) for b in tops[i + 1:]]
    return {"ranks": ranks, "overlap": float(np.mean(pairs)), "top": top}


def explain_row(model: CatBoostClassifier, x: pd.DataFrame) -> dict:
    """Explain ONE forecast (x = single-row frame): baseline odds -> each feature's push -> final probabilities."""
    shap, base = shap_values(model, x)
    probs = probabilities_from_shap(shap, base)[0]
    return {"shap": shap[0], "baseline": base, "probs": probs, "features": list(x.columns), "values": x.iloc[0].to_numpy()}


def top_drivers(model: CatBoostClassifier, x: pd.DataFrame, n: int = 3) -> list[dict]:
    """The n inputs that moved today's DOMINANT class the most, in plain language (for snapshot / UI)."""
    e = explain_row(model, x)
    k = int(np.argmax(e["probs"]))
    order = np.argsort(-np.abs(e["shap"][k]))[:n]
    return [
        {
            "feature": e["features"][i],
            "label": FEATURE_DOC.get(e["features"][i], e["features"][i]),
            "value": round(float(e["values"][i]), 6),
            "effect": round(float(e["shap"][k][i]), 4),
            "direction": "raises" if e["shap"][k][i] > 0 else "lowers",
            "class": CLASS_NAMES[k],
        }
        for i in order
    ]


# =============================================================================== charts
def fig_global_importance(gi: pd.DataFrame, top: int = 10):
    gi = gi.loc[gi.sum(axis=1).sort_values(ascending=False).index[:top]][::-1]
    fig, ax = ev._fig(8, 4.6)
    ax.grid(axis="y", visible=False)
    ax.grid(axis="x", color=ev.GRID, linewidth=0.6)
    left = np.zeros(len(gi))
    for name, col in zip(CLASS_NAMES, ev.CLASS_COLORS):
        ax.barh(gi.index, gi[name], left=left, color=col, height=0.62, label=name, edgecolor=ev.SURFACE, linewidth=1.5)
        left += gi[name].to_numpy()
    ax.tick_params(axis="y", labelsize=8.5, colors=ev.INK2)
    ax.set_xlabel("mean |SHAP| (log-odds): how hard the feature pushes each outcome", color=ev.MUTED, fontsize=8)
    ev._title(ax, "Which inputs move the forecast", "Bar length = total push, split by the outcome it pushes")
    ev._legend(ax, loc="lower right")
    return fig


def fig_dependence(shap: np.ndarray, X: pd.DataFrame, gi: pd.DataFrame, cls: int = 2, top: int = 3):
    """Feature value (x) vs its SHAP push on one class (y): shows the DIRECTION of each effect."""
    feats = list(gi[CLASS_NAMES[cls]].sort_values(ascending=False).index[:top])
    fig, axes = ev._fig(9.5, 3.4, ncols=top, sharey=True)
    for ax, f in zip(np.atleast_1d(axes), feats):
        j = list(X.columns).index(f)
        x, s = X[f].to_numpy(), shap[:, cls, j]
        ax.scatter(x, s, s=7, color=ev.CLASS_COLORS[cls], alpha=0.35, linewidths=0, label=CLASS_NAMES[cls])
        order = np.argsort(x)
        trend = pd.Series(s[order]).rolling(max(len(s) // 15, 20), center=True, min_periods=10).mean()
        ax.plot(x[order], trend, color=ev.INK, lw=1.8, label="trend")
        ax.axhline(0, color=ev.AXIS, lw=1)
        ax.set_xlabel(f, color=ev.INK2, fontsize=8.5)
        ev._legend(ax, loc="upper left")
    np.atleast_1d(axes)[0].set_ylabel(f"push on '{CLASS_NAMES[cls]}' (log-odds)", color=ev.MUTED, fontsize=8)
    fig.suptitle(f"Direction of effect on '{CLASS_NAMES[cls]}': above zero raises its odds, below lowers them",
                 x=0.01, ha="left", fontsize=10.5, color=ev.INK, fontweight="semibold")
    return fig


def fig_stability(stab: dict, top: int = 8):
    ranks = stab["ranks"]
    keep = ranks.mean(axis=1).sort_values().index[:top]
    r = ranks.loc[keep]
    fig, ax = ev._fig(7.5, 4.2)
    ax.grid(False)
    ax.imshow(-r.to_numpy(), cmap=ev.SEQ_BLUE, aspect="auto")
    for i in range(r.shape[0]):
        for j in range(r.shape[1]):
            ax.text(j, i, str(r.iat[i, j]), ha="center", va="center", fontsize=9,
                    color="white" if r.iat[i, j] <= 3 else ev.INK)
    ax.set_xticks(range(r.shape[1]), r.columns, fontsize=8.5, color=ev.INK2)
    ax.set_yticks(range(r.shape[0]), r.index, fontsize=8.5, color=ev.INK2)
    for s in ax.spines.values():
        s.set_visible(False)
    ev._title(ax, f"Are the drivers stable? Top-{stab['top']} overlap between folds: {stab['overlap']:.0%}",
              "Cell = importance rank in that fold (1 = most important). Similar columns = trustworthy drivers")
    return fig


def fig_waterfall(e: dict, cls: int | None = None, top: int = 8):
    """Baseline odds -> each feature's push -> final log-odds for ONE forecast."""
    k = int(np.argmax(e["probs"])) if cls is None else cls
    order = np.argsort(-np.abs(e["shap"][k]))[:top]
    names = [f"{e['features'][i]} = {e['values'][i]:.3g}" for i in order][::-1]
    vals = e["shap"][k][order][::-1]
    rest = float(e["shap"][k].sum() - vals.sum())
    names, vals = ["all other inputs"] + names, np.r_[rest, vals]
    fig, ax = ev._fig(8, 4.6)
    ax.grid(axis="y", visible=False)
    ax.grid(axis="x", color=ev.GRID, linewidth=0.6)
    colors = [ev.CLASS_COLORS[k] if v > 0 else ev.MUTED for v in vals]
    ax.barh(names, vals, color=colors, height=0.6)
    for y_, v in enumerate(vals):
        ax.text(v + (0.004 if v >= 0 else -0.004), y_, f"{v:+.3f}", va="center", ha="left" if v >= 0 else "right",
                fontsize=8, color=ev.INK2)
    ax.axvline(0, color=ev.AXIS, lw=1)
    span = max(abs(vals).max(), 1e-6)  # room on both sides so value labels never run into the y-axis text
    ax.set_xlim(min(vals.min(), 0) - 0.28 * span, max(vals.max(), 0) + 0.28 * span)
    ax.tick_params(axis="y", labelsize=8.5, colors=ev.INK2)
    pr =", ".join(f"{n.split()[0]} {p:.0%}" for n, p in zip(CLASS_NAMES, e["probs"]))
    ev._title(ax, f"Why '{CLASS_NAMES[k]}' for this forecast ({pr})",
              f"Colored = pushes '{CLASS_NAMES[k]}' up, grey = pushes it down (log-odds, added to the baseline)")
    return fig


def fig_band_width(raw: pd.DataFrame, bands_params: dict, last: int = 750):
    """A band explains itself: width = sqrt(H-day variance) x (z90 - z10), so it breathes with volatility."""
    from .bands import band_returns
    from .vol import ewma_hday_var

    r = np.log(raw["xau"] / raw["xau"].shift(1)).to_numpy()
    hv = ewma_hday_var(r, bands_params["ewma_lambda"])
    b = band_returns(hv, bands_params["quantiles_ewma"])
    width = 100 * (np.exp(b["q90"]) - np.exp(b["q10"]))
    idx = raw.index[-last:]
    fig, ax = ev._fig(9, 3.4)
    ax.plot(idx, width[-last:], color=ev.BLUE, lw=1.6, label=f"P10-P90 band width, % of price ({HORIZON}-session)")
    ev._title(ax, "Why the band is as wide as it is",
              "Width = expected volatility x (z90 - z10). Calm markets give narrow bands, wild ones wide bands")
    ax.set_ylabel("band width (% of price)", color=ev.MUTED, fontsize=8)
    ev._legend(ax, loc="upper left", bbox_to_anchor=(0, 0.93))
    return fig


# =============================================================================== report section
def write_section(fig_dir, ctx: dict) -> list[str]:
    """Create the explainability figures and return the markdown for the report."""
    model, X, y, features = ctx["model"], ctx["X"], ctx["y"], ctx["features"]
    shap, base = shap_values(model, X)
    gi = global_importance(shap, features)
    stab = driver_stability(X, y, ctx["n_tr"], ctx["params"])
    live = ctx.get("live_row")
    figs = {
        "xai_global": fig_global_importance(gi),
        "xai_dependence": fig_dependence(shap, X, gi),
        "xai_stability": fig_stability(stab),
    }
    md = [
        "## Explainability (what the model leans on)",
        "SHAP values explain each forecast exactly: baseline odds + each input's push = the model's output. "
        "They show what the model *used*, not what *caused* gold to move.\n",
        "![Global drivers](figures/xai_global.png)\n![Direction of effect](figures/xai_dependence.png)\n"
        "![Driver stability](figures/xai_stability.png)\n",
        f"Driver stability: the top-{stab['top']} inputs overlap {stab['overlap']:.0%} between walk-forward folds "
        "(low overlap = the model's reasoning changes with the period, a warning sign).\n",
    ]
    if live is not None:
        e = explain_row(model, live)
        figs["xai_today"] = fig_waterfall(e)
        md += ["### Today's forecast, explained", "![Today](figures/xai_today.png)\n"]
    if "bands_params" in ctx:
        figs["xai_band_width"] = fig_band_width(ctx["raw"], ctx["bands_params"])
        md += ["### Why the price band has its width", "![Band width](figures/xai_band_width.png)\n"]
    for name, fig in figs.items():
        fig.savefig(fig_dir / f"{name}.png", dpi=140, facecolor=ev.SURFACE)
        ev.plt.close(fig)
    ctx["_stability"] = stab
    return md
