"""Evaluation: numbers, charts and the ship / no-ship rules for both models.

WHY THIS FILE EXISTS
    A single accuracy number says almost nothing about a forecaster of a noisy market. We want to
    know: (1) is it better than just guessing the historical frequencies ("climatology")?
    (2) when it says 40%, does that happen about 40% of the time ("calibration")?
    (3) do the price bands contain the outcome about 80% of the time ("coverage")?
    Each question below has a function, a chart, and an explicit pass/fail threshold.

PIECES
    ece / reliability_table   calibration maths            fig_*      charts (each returns a Figure)
    acceptance                the ship / no-ship rules     write_report  writes reports/latest.md + PNGs

Charts follow one validated palette (blue / orange / aqua = first three categorical slots, ink
greys for chrome) on the light chart surface, with a legend and direct labels on every chart.
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import matplotlib

if "ipykernel" not in sys.modules:  # CLI / CI: no display needed. Notebooks keep their inline backend.
    matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.colors import LinearSegmentedColormap
from sklearn.metrics import confusion_matrix

from .constants import HORIZON, LABEL_K
from .features import CLASS_NAMES, FEATURE_DOC

# ---- palette (light surface). Categorical slots 1-3 validated all-pairs; aqua is <3:1 contrast,
# so every chart ships a legend + direct labels (the skill's "relief rule").
SURFACE, INK, INK2, MUTED, GRID, AXIS = "#fcfcfb", "#0b0b0b", "#52514e", "#898781", "#e1e0d9", "#c3c2b7"
BLUE, ORANGE, AQUA = "#2a78d6", "#eb6834", "#1baf7a"
CLASS_COLORS = [BLUE, ORANGE, AQUA]  # Bearish, Sideways, Bullish - fixed order, never re-assigned
SEQ_BLUE = LinearSegmentedColormap.from_list("seq_blue", ["#cde2fb", "#6da7ec", "#256abf", "#184f95"])
plt.rcParams["font.family"] = "sans-serif"
plt.rcParams["font.sans-serif"] = ["Segoe UI", "Helvetica Neue", "Arial", "DejaVu Sans"]

# ---- ship / no-ship thresholds (documented in ml/README.md; change them here, in one place)
MIN_FOLDS_BEATING_PRIOR = 3  # of 5 walk-forward folds
MAX_ECE = 0.05
COVERAGE_TARGET, COVERAGE_TOL = 0.80, 0.05
PROB_COLS = ["p0", "p1", "p2"]


# =============================================================================== maths
def reliability_table(y: np.ndarray, p: np.ndarray, n_bins: int = 10, min_count: int = 20) -> list[pd.DataFrame]:
    """Per class: bin the predicted probability, compare to how often the class actually happened.

    A well-calibrated model has predicted ~= observed in every bin (points on the diagonal).
    Bins with fewer than `min_count` samples are dropped - their frequency is just noise.
    """
    out = []
    edges = np.linspace(0, 1, n_bins + 1)
    for k in range(3):
        pk, hit = p[:, k], (np.asarray(y) == k).astype(float)
        b = np.clip(np.digitize(pk, edges[1:-1]), 0, n_bins - 1)
        rows = [
            {"predicted": pk[b == i].mean(), "observed": hit[b == i].mean(), "n": int((b == i).sum())}
            for i in range(n_bins) if (b == i).sum() >= min_count
        ]
        out.append(pd.DataFrame(rows, columns=["predicted", "observed", "n"]))
    return out


def ece(y: np.ndarray, p: np.ndarray, n_bins: int = 10) -> float:
    """Expected Calibration Error: the average gap between predicted and observed frequency,
    weighted by how many samples fall in each bin, averaged over the 3 classes (one-vs-rest).
    0 = perfectly calibrated. We use min_count=1 here so no sample is silently ignored."""
    total = []
    for tbl in reliability_table(y, p, n_bins, min_count=1):
        w = tbl["n"] / tbl["n"].sum()
        total.append(float((w * (tbl["predicted"] - tbl["observed"]).abs()).sum()))
    return float(np.mean(total))


def _row_losses(df: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    """Per-row log-loss of the model and of the climatology baseline (lower = better)."""
    r = np.arange(len(df))
    y = df["y"].to_numpy(dtype=int)
    model = -np.log(np.clip(df[PROB_COLS].to_numpy()[r, y], 1e-9, 1))
    base = -np.log(np.clip(df[["q0", "q1", "q2"]].to_numpy()[r, y], 1e-9, 1))
    return pd.Series(model, index=df.index), pd.Series(base, index=df.index)


def block_bootstrap_ci(d: np.ndarray, block: int = 20, reps: int = 2000, alpha: float = 0.10, seed: int = 0):
    """Interval for the mean of `d` (per-row improvement) that respects serial correlation.

    Resample whole blocks of consecutive rows with replacement; repeated 2,000 times. The 5%/95% quantiles of the
    resampled means form a 90% interval. A plain row-by-row bootstrap would be far too optimistic here.
    """
    d = np.asarray(d, dtype=float)
    n = len(d)
    n_blocks = int(np.ceil(n / block))
    starts = np.arange(0, n - block + 1)
    rng = np.random.default_rng(seed)
    means = np.empty(reps)
    for i in range(reps):
        idx = (rng.choice(starts, n_blocks)[:, None] + np.arange(block)).ravel()[:n]
        means[i] = d[idx].mean()
    return float(np.quantile(means, alpha / 2)), float(np.quantile(means, 1 - alpha / 2))


# =============================================================================== rules
def acceptance(folds: list[dict], oof: pd.DataFrame, test_m: dict, band_report: dict) -> dict:
    """The ship / no-ship rules. Model A needs ALL its checks; Model B needs ALL of its.

    If Model A fails, the app hides the regime percentages and shows only the volatility bands.
    The thresholds are modest on purpose: markets are noisy, so "beats the baseline, is honest about
    its uncertainty, AND the gain is statistically real" is the realistic bar - not "predicts well".

    A4 was added after the first experiment round showed a winner that passed A1-A3 while its gain was
    indistinguishable from luck (owner decision, 2026-10-06): a rule that can be passed by chance is not a rule.
    """
    n_beat = sum(bool(f["beats_prior"]) for f in folds)
    oof_ece = ece(oof["y"].to_numpy(), oof[PROB_COLS].to_numpy())
    m, b = _row_losses(oof)
    lo, hi = block_bootstrap_ci((b - m).to_numpy())  # 90% interval of the out-of-fold log-loss gain over climatology
    best = min(("garch", "ewma"), key=lambda k: abs(band_report[k]["coverage_p10_p90"] - COVERAGE_TARGET))
    cov, pin = band_report[best]["coverage_p10_p90"], band_report[best]["pinball"]
    const_pin = band_report["constant_vol_baseline"]["pinball"]

    def chk(id_, model, desc, value, rule, ok):
        return {"id": id_, "model": model, "desc": desc, "value": float(value), "rule": rule, "passed": bool(ok)}

    checks = [
        chk("A1", "A", "Held-out year log-loss beats climatology", test_m["logloss"], f"< {test_m['logloss_prior']:.3f}",
            test_m["logloss"] < test_m["logloss_prior"]),
        chk("A2", "A", "Walk-forward folds beating climatology", n_beat, f">= {MIN_FOLDS_BEATING_PRIOR} of {len(folds)}",
            n_beat >= MIN_FOLDS_BEATING_PRIOR),
        chk("A3", "A", "Calibration error (ECE, out-of-fold)", oof_ece, f"<= {MAX_ECE}", oof_ece <= MAX_ECE),
        chk("A4", "A", "Gain over climatology is statistically real (90% interval lower bound)", lo, "> 0", lo > 0),
        chk("B1", "B", f"P10-P90 coverage ({best.upper()}, held-out year)", cov,
            f"{COVERAGE_TARGET - COVERAGE_TOL:.2f}-{COVERAGE_TARGET + COVERAGE_TOL:.2f}",
            abs(cov - COVERAGE_TARGET) <= COVERAGE_TOL + 1e-9),
        chk("B2", "B", f"Pinball loss ({best.upper()}) beats constant-vol baseline", pin, f"< {const_pin:.5f}", pin < const_pin),
    ]
    return {
        "checks": checks,
        "summary": {
            "skill_evidence": bool(lo > 0),
            "oof_gain_ci90": [lo, hi],
            "model_a_ship": all(c["passed"] for c in checks if c["model"] == "A"),
            "model_b_ship": all(c["passed"] for c in checks if c["model"] == "B"),
            "recommended_band": best,
            "folds_beating_prior": n_beat,
            "oof_ece": oof_ece,
        },
    }


# =============================================================================== chart helpers
def _style(ax) -> None:
    ax.set_facecolor(SURFACE)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(AXIS)
        ax.spines[s].set_linewidth(0.8)
    ax.tick_params(colors=MUTED, labelsize=8, length=3, color=AXIS)
    ax.grid(axis="y", color=GRID, linewidth=0.6)  # recessive hairlines, horizontal only
    ax.set_axisbelow(True)


def _fig(w: float = 7.5, h: float = 4.0, **kw):
    fig, axes = plt.subplots(figsize=(w, h), facecolor=SURFACE, layout="constrained", **kw)
    for ax in np.atleast_1d(axes).ravel():
        _style(ax)
    return fig, axes


def _title(ax, headline: str, sub: str | None = None) -> None:
    ax.set_title(headline, loc="left", fontsize=11, color=INK, fontweight="semibold", pad=18 if sub else 8)
    if sub:
        ax.text(0, 1.03, sub, transform=ax.transAxes, fontsize=8.5, color=INK2, va="bottom")


def _legend(ax, **kw) -> None:
    ax.legend(frameon=False, fontsize=8, labelcolor=INK2, **kw)


# =============================================================================== charts
def fig_gold_history(raw: pd.DataFrame):
    fig, ax = _fig(8, 3.4)
    ax.plot(raw.index, raw["xau"], color=BLUE, lw=1.5, label="Gold futures (GC=F), USD/oz")
    _title(ax, "Gold has tripled since 2010 - raw prices are not stationary",
           "Why we model returns and ratios, never the price level itself")
    ax.set_ylabel("USD per troy oz", color=MUTED, fontsize=8)
    _legend(ax, loc="upper left")
    return fig


def fig_class_mix(y: pd.Series):
    mix = y.value_counts(normalize=True).sort_index()
    fig, ax = _fig(5.5, 3.2)
    bars = ax.bar(CLASS_NAMES, mix.values * 100, color=CLASS_COLORS, width=0.55)
    for b, v in zip(bars, mix.values):
        ax.text(b.get_x() + b.get_width() / 2, v * 100 + 1, f"{v:.0%}", ha="center", fontsize=9, color=INK)
    _title(ax, "Class balance", f"Share of sessions by what gold did over the next {HORIZON} sessions "
           f"(big move = more than {LABEL_K}× expected volatility)")
    ax.set_ylim(0, max(mix.values * 100) * 1.2)
    ax.set_ylabel("% of sessions", color=MUTED, fontsize=8)
    ax.tick_params(axis="x", labelsize=8.5, colors=INK2)
    return fig


def fig_threshold(labels: pd.DataFrame):
    """What 'a big move' meant on each day: the volatility-scaled threshold, in %."""
    thr = labels["threshold"].iloc[200:] * 100
    fig, ax = _fig(9, 3.4)
    ax.plot(thr.index, thr, color=BLUE, lw=1.5, label=f"threshold = {LABEL_K} x expected {HORIZON}-session volatility")
    ax.axhline(1.5, color=INK2, lw=1.1, ls="--", label="old fixed rule: +/-1.5%")
    _title(ax, "A 'big move' is relative: the threshold follows volatility",
           "Calm markets need a small move to count; wild markets need a large one")
    ax.set_ylabel("move that counts as big (%)", color=MUTED, fontsize=8)
    _legend(ax, loc="upper left", bbox_to_anchor=(0, 0.93))
    return fig


def fig_class_mix_by_year(y: pd.Series):
    """Share of each class per calendar year - should stay roughly flat with volatility-scaled labels."""
    mix = pd.crosstab(y.index.year, y, normalize="index") * 100
    fig, ax = _fig(9, 3.6)
    bottom = np.zeros(len(mix))
    for k, (name, col) in enumerate(zip(CLASS_NAMES, CLASS_COLORS)):
        ax.bar(mix.index, mix[k].values, bottom=bottom, color=col, width=0.8, label=name, edgecolor=SURFACE, linewidth=1.5)
        bottom += mix[k].values
    ax.set_ylim(0, 100)
    ax.set_xticks(mix.index, [str(v) for v in mix.index], fontsize=8)
    _title(ax, "Class mix per year", "With a fixed +/-1.5% rule these bars swung with volatility; scaled labels keep them steady")
    ax.set_ylabel("% of sessions", color=MUTED, fontsize=8)
    ax.legend(frameon=False, fontsize=8, labelcolor=INK2, ncols=3, loc="upper center", bbox_to_anchor=(0.5, -0.1))
    return fig


def fig_cv_improvement(folds: list[dict]):
    gain = [f["logloss_prior"] - f["logloss"] for f in folds]  # >0 means the model beat climatology
    fig, ax = _fig(7, 3.6)
    bars = ax.bar([f"Fold {f['fold'] + 1}\n{f['val_start'][:7]}-{f['val_end'][:7]}" for f in folds], gain,
                  color=BLUE, width=0.55, label="Log-loss improvement vs climatology")
    for b, v in zip(bars, gain):
        ax.text(b.get_x() + b.get_width() / 2, v + (0.002 if v >= 0 else -0.002), f"{v:+.3f}", ha="center",
                va="bottom" if v >= 0 else "top", fontsize=8.5, color=INK)
    ax.axhline(0, color=AXIS, lw=1)
    span = max(gain + [0]) - min(gain + [0])  # headroom so value labels never touch the title or x labels
    ax.set_ylim(min(gain + [0]) - 0.22 * span, max(gain + [0]) + 0.18 * span)
    ax.tick_params(axis="x", pad=6)
    n = sum(g > 0 for g in gain)
    _title(ax, f"Model beats the baseline in {n} of {len(folds)} walk-forward folds",
           "Above zero = better than always predicting the historical class mix (log-loss units)")
    ax.tick_params(axis="x", labelsize=7.5)
    _legend(ax, loc="lower right")
    return fig


def fig_reliability(oof: pd.DataFrame):
    tables = reliability_table(oof["y"].to_numpy(), oof[PROB_COLS].to_numpy())
    e = ece(oof["y"].to_numpy(), oof[PROB_COLS].to_numpy())
    fig, axes = _fig(9, 3.4, ncols=3, sharey=True, sharex=True)
    for ax, tbl, name, col in zip(axes, tables, CLASS_NAMES, CLASS_COLORS):
        ax.plot([0, 1], [0, 1], color=AXIS, lw=1, ls="--", label="perfect")
        ax.plot(tbl["predicted"], tbl["observed"], color=col, lw=1.8, marker="o", ms=5,
                markeredgecolor=SURFACE, markeredgewidth=1.2, label=name)
        ax.set_title(name, loc="left", fontsize=9.5, color=INK2)
        ax.set_xlabel("predicted probability", color=MUTED, fontsize=8)
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1)
        _legend(ax, loc="upper left")
    axes[0].set_ylabel("how often it really happened", color=MUTED, fontsize=8)
    fig.suptitle(f"Calibration: when the model says X%, does it happen X% of the time?  (ECE = {e:.3f}; 0 = perfect)",
                 x=0.01, ha="left", fontsize=10.5, color=INK, fontweight="semibold")
    return fig


def fig_confusion(test_df: pd.DataFrame):
    y = test_df["y"].to_numpy(dtype=int)
    pred = test_df[PROB_COLS].to_numpy().argmax(1)
    cm = confusion_matrix(y, pred, labels=[0, 1, 2])
    fig, ax = _fig(5.6, 4.4)
    ax.grid(False)
    rowpct = cm / np.maximum(cm.sum(1, keepdims=True), 1)
    ax.imshow(rowpct, cmap=SEQ_BLUE, vmin=0, vmax=1)
    for i in range(3):
        for j in range(3):
            ax.text(j, i, f"{cm[i, j]}\n{rowpct[i, j]:.0%}", ha="center", va="center", fontsize=9,
                    color="white" if rowpct[i, j] > 0.5 else INK)
    ax.set_xticks(range(3), [c.split()[0] for c in CLASS_NAMES], fontsize=8.5, color=INK2)
    ax.set_yticks(range(3), [c.split()[0] for c in CLASS_NAMES], fontsize=8.5, color=INK2)
    ax.set_xlabel("model's top pick", color=MUTED, fontsize=8)
    ax.set_ylabel("what actually happened", color=MUTED, fontsize=8)
    for s in ax.spines.values():
        s.set_visible(False)
    _title(ax, "Held-out year: what the model picked vs what happened", "Count and % of each true class (rows add to 100%)")
    return fig


def fig_rolling_logloss(oof: pd.DataFrame, test_df: pd.DataFrame, window: int = 60):
    fig, ax = _fig(9, 3.8)
    for df, tag in ((oof.sort_index(), "cv"), (test_df, "test")):
        m, b = _row_losses(df)
        mm, bb = m.rolling(window).mean(), b.rolling(window).mean()
        ax.plot(mm.index, mm, color=BLUE, lw=1.5, label="Model" if tag == "cv" else None)
        ax.plot(bb.index, bb, color=INK2, lw=1.3, ls="--", label="Climatology baseline" if tag == "cv" else None)
    ax.axvspan(test_df.index[0], test_df.index[-1], color=BLUE, alpha=0.07, lw=0)
    ax.text(test_df.index[0], ax.get_ylim()[1], " held-out year", fontsize=8, color=INK2, va="top")
    _title(ax, f"Where the model helps and hurts ({window}-session rolling log-loss)",
           "Lower is better. Model line below the dashed line = beating the baseline")
    _legend(ax, loc="upper left", bbox_to_anchor=(0, 0.93))
    return fig


def fig_bands(band_eval: dict):
    d, spot, fwd = band_eval["dates"], band_eval["spot"], band_eval["fwd"]
    realised = spot * np.exp(fwd)  # price actually reached HORIZON sessions after each forecast
    fig, axes = _fig(9, 6.2, nrows=2, sharex=True)
    for ax, key, label in zip(axes, ("ewma", "garch"), ("EWMA", "GARCH")):
        b = band_eval["bands"][key]
        lo, hi = spot * np.exp(b["q10"]), spot * np.exp(b["q90"])
        miss = np.isfinite(realised) & ((realised < lo) | (realised > hi))
        ax.fill_between(d, lo, hi, color=BLUE, alpha=0.2, lw=0, label="forecast P10-P90 band")
        ax.plot(d, realised, color=INK2, lw=1.3, label=f"price {HORIZON} sessions later")
        ax.scatter(d[miss], realised[miss], s=14, color=ORANGE, zorder=3, edgecolors=SURFACE, linewidths=0.8,
                   label="outside the band")
        cov = band_eval["report"][key]["coverage_p10_p90"]
        ax.set_title(f"{label}: realised price stayed inside the band {cov:.0%} of the time (ideal 80%)", loc="left",
                     fontsize=9.5, color=INK2)
        _legend(ax, loc="upper left")
    fig.suptitle("Volatility bands over the held-out year", x=0.01, ha="left", fontsize=11, color=INK, fontweight="semibold")
    return fig


def fig_importance(imp: dict, top: int = 12):
    items = list(imp.items())[:top][::-1]
    fig, ax = _fig(7, 4.2)
    ax.grid(axis="y", visible=False)
    ax.grid(axis="x", color=GRID, linewidth=0.6)
    bars = ax.barh([k for k, _ in items], [v for _, v in items], color=BLUE, height=0.6)
    for b, (_, v) in zip(bars, items):
        ax.text(v + 0.2, b.get_y() + b.get_height() / 2, f"{v:.1f}", va="center", fontsize=8, color=INK2)
    ax.tick_params(axis="y", labelsize=8.5, colors=INK2)
    _title(ax, "Which inputs the model leans on", "CatBoost importance (how much predictions change when a feature changes)")
    return fig


# =============================================================================== report
def _md_table(headers: list[str], rows: list[list]) -> str:
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def write_report(out_dir: Path, ctx: dict) -> dict:
    """Write reports/latest.md + reports/figures/*.png; return the acceptance verdict."""
    fig_dir = out_dir / "figures"
    fig_dir.mkdir(parents=True, exist_ok=True)
    folds, oof, test_m, test_df = ctx["folds"], ctx["oof"], ctx["test_m"], ctx["test_df"]
    be, df, n_test = ctx["band_eval"], ctx["df"], ctx["n_test"]
    verdict = acceptance(folds, oof, test_m, be["report"])

    for name, fig in {
        "threshold": fig_threshold(ctx["labels"]),
        "class_mix_by_year": fig_class_mix_by_year(ctx["y"]),
        "cv_improvement": fig_cv_improvement(folds),
        "reliability": fig_reliability(oof),
        "confusion": fig_confusion(test_df),
        "rolling_logloss": fig_rolling_logloss(oof, test_df),
        "bands": fig_bands(be),
        "importance": fig_importance(ctx["imp"]),
    }.items():
        fig.savefig(fig_dir / f"{name}.png", dpi=140, facecolor=SURFACE)
        plt.close(fig)

    s = verdict["summary"]
    explain_md: list[str] = []
    if "model" in ctx:  # explainability needs the fitted production model
        from . import explain  # imported here: explain imports this module for its chart helpers
        explain_md = explain.write_section(fig_dir, ctx)
    ok = lambda b: "PASS" if b else "FAIL"  # noqa: E731
    br = be["report"]
    lines = [
        "# Paun forecast models - evaluation report",
        f"Generated {date.today()} · data {df.index[0].date()} to {df.index[-1].date()} ({len(df)} labelled sessions) · "
        f"held-out test year = last {n_test} sessions · horizon = {HORIZON} sessions\n",
        "## Verdict",
        f"- **Model A (regime probabilities): {'SHIP' if s['model_a_ship'] else 'DO NOT SHIP - show bands only'}**",
        f"- **Model B (price bands, {s['recommended_band'].upper()}): {'SHIP' if s['model_b_ship'] else 'DO NOT SHIP'}**\n",
        f"- *Rule A4 (statistical evidence of skill):* the out-of-fold log-loss improvement over climatology has a 90% "
        f"interval of [{s['oof_gain_ci90'][0]:+.4f}, {s['oof_gain_ci90'][1]:+.4f}] - "
        f"{'excludes 0: the edge is statistically real' if s['skill_evidence'] else 'INCLUDES 0: the edge cannot be told apart from luck, so Model A is not shipped'}.\n",
        _md_table(["Check", "What it tests", "Value", "Rule", "Result"],
                  [[c["id"], c["desc"], f"{c['value']:.4g}", c["rule"], ok(c["passed"])] for c in verdict["checks"]]),
        "\n## How to read this",
        "- **Log-loss**: scores the probabilities themselves; confident wrong answers are punished hard. Lower is better. "
        "**Climatology** = always predict the historical class mix; any real model must beat it.",
        "- **Walk-forward folds**: train on the past, test on the next unseen stretch, repeat 5 times. Never shuffled.",
        "- **Calibration (ECE)**: do 40% predictions come true ~40% of the time? **Coverage**: how often the real price "
        "landed inside the P10-P90 band (ideal 80%).\n",
        "## Labels",
        f"A day is **Bullish / Bearish** when gold's next-{HORIZON}-session move exceeds {LABEL_K} x the expected "
        "move for current volatility (today's threshold is in the snapshot). Sideways = anything in between.\n",
        "![Threshold](figures/threshold.png)\n![Class mix by year](figures/class_mix_by_year.png)\n",
        "## Model A - regime classifier",
        _md_table(["Fold", "Validation period", "Train rows", "Log-loss", "Climatology", "Beats baseline"],
                  [[f["fold"] + 1, f"{f['val_start']} → {f['val_end']}", f["train_rows"], f"{f['logloss']:.4f}",
                    f"{f['logloss_prior']:.4f}", "yes" if f["beats_prior"] else "no"] for f in folds]),
        "",
        _md_table(["Held-out year", "Log-loss", "Climatology", "Brier", "Accuracy", "Macro-F1"],
                  [["model", f"{test_m['logloss']:.4f}", f"{test_m['logloss_prior']:.4f}", f"{test_m['brier']:.4f}",
                    f"{test_m['accuracy']:.1%}", f"{test_m['macro_f1']:.3f}"]]),
        "\n![CV improvement](figures/cv_improvement.png)\n![Calibration](figures/reliability.png)\n"
        "![Confusion](figures/confusion.png)\n![Rolling log-loss](figures/rolling_logloss.png)\n"
        "![Feature importance](figures/importance.png)\n",
        *explain_md,
        "## Model B - volatility bands",
        _md_table(["Method (held-out year)", "P10-P90 coverage (ideal 80%)", "Pinball loss (lower better)"],
                  [[n, f"{br[k]['coverage_p10_p90']:.1%}", f"{br[k]['pinball']:.5f}"] for n, k in
                   (("GARCH(1,1)", "garch"), ("EWMA (λ=0.94)", "ewma"), ("Constant-vol baseline", "constant_vol_baseline"))]),
        "\n![Bands](figures/bands.png)\n",
        "## Model file check",
        f"`regime.onnx` reproduces CatBoost probabilities to max |diff| = {ctx['export']['max_abs_diff']:.1e} "
        f"(ZipMap stripped: {ctx['export']['zipmap_stripped']}).\n",
        "## Feature glossary",
        _md_table(["Feature", "Meaning"], [[k, FEATURE_DOC[k]] for k in ctx["imp"]]),
    ]
    (out_dir / "latest.md").write_text("\n".join(lines), encoding="utf-8")
    return verdict
