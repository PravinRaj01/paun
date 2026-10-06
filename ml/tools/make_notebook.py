"""Generates ml/colab.ipynb - the guided, segmented walkthrough.   Run from ml/:  python tools/make_notebook.py

Layout: top-level (#) headers are the classic phases; (##) headers are the steps inside them (Colab turns
them into a collapsible table of contents).  Looking at / cleaning the data is written in plain pandas so every
step is visible and editable; production logic (features, labels, models) comes from `paun_ml`, so the notebook
can never drift from what ships.  The notebook ships WITHOUT outputs; Colab/Jupyter fill them on run.
"""
import nbformat as nbf

nb = nbf.v4.new_notebook()
cells = []
md = lambda s: cells.append(nbf.v4.new_markdown_cell(s.strip("\n")))
code = lambda s: cells.append(nbf.v4.new_code_cell(s.strip("\n")))

# ============================================================================================ TITLE
md(r"""
**Paun · gold regime & volatility forecast**

A guided notebook that **collects, cleans, models and honestly evaluates** the two forecasts behind Paun's forecast
card — and explains them. Sections, in order:
**1 Setup & Configuration → 2 Data Collection → 3 Data Preparation → 4 Data Cleaning → 5 Feature Engineering →
6 Target Labelling & Train/Test Split → 7 Model Training → 8 Evaluation → 9 Explainable AI → 10 Export & Deployment → 11 Conclusion.**

| Product | Question it answers | Model |
|---|---|---|
| **Regime probabilities** | "Over the next 5 trading days, how likely is gold to fall by an *unusually large* amount, stay put, or rise by an unusually large amount?" | **Model A** — CatBoost classifier |
| **Price bands** | "Between which two prices will gold probably be in 5 days (P10 / P50 / P90)?" | **Model B** — volatility (GARCH / EWMA) |

*Why not predict the exact price?* Gold behaves close to a random walk driven by surprises, so exact-price models
only look good in hindsight. Probabilities and ranges are the honest products.

**How the code is organised:** looking at and cleaning data is written here in plain pandas, so you can see and edit every
step. Features, labels, models and charts come from the `paun_ml` package, the *same code* the daily GitHub Action and
the tests use — so what you read here is exactly what ships.
""")

# ============================================================================================ SETUP
md(r"""
# 1. Setup & Configuration

## Get the Code & Install Dependencies

Colab starts as an empty machine. The first cell clones the repo (so `paun_ml/` and `requirements.txt` exist) and installs
dependencies. **Why a repo and not code pasted into the notebook?** The same feature code must run in training, in the
daily GitHub Action, in the tests and (ported) in the browser. One shared package means they can never drift apart
(*train/serve skew* = a model trained on inputs computed one way and fed inputs computed another way, which silently ruins predictions).

*Repo not pushed yet, or running on Kaggle?* The cell also works on **Kaggle** (turn **Internet** on in the notebook settings). If the clone fails it looks for an uploaded dataset containing the `ml/` folder under `/kaggle/input`; on Colab you can also zip + upload `ml/` (see `ml/README.md`).
""")
code(r"""
import os, sys, shutil, subprocess
from pathlib import Path

REPO_URL = "https://github.com/PravinRaj01/paun.git"
IN_COLAB = "google.colab" in sys.modules
IN_KAGGLE = os.path.exists("/kaggle/working")

if IN_COLAB or IN_KAGGLE:                               # hosted notebook: start empty, so fetch the repo + install deps
    os.chdir("/content" if IN_COLAB else "/kaggle/working")
    if not os.path.exists("paun/ml"):
        clone = subprocess.run(["git", "clone", "--depth", "1", REPO_URL], capture_output=True, text=True)
        if clone.returncode != 0:                       # repo private/empty, or Kaggle "Internet" switched off
            uploaded = list(Path("/kaggle/input").glob("*/ml")) if IN_KAGGLE else []   # fallback: an uploaded Kaggle dataset
            if not uploaded:
                raise SystemExit("git clone failed and no uploaded 'ml' folder found - see ml/README.md\n" + clone.stderr)
            shutil.copytree(uploaded[0], "paun/ml")
    os.chdir("paun/ml")
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", "requirements.txt"], check=True)
sys.path.insert(0, os.getcwd())                         # locally: start Jupyter inside the ml/ folder

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from IPython.display import display

from paun_ml import data, features as F, bands, train_regime as tr, experiments as ex, evaluate as ev, explain
from paun_ml.constants import HORIZON, LABEL_K, BURN_IN
from paun_ml.model_config import load_config, catboost_params
pd.set_option("display.width", 140)
print("imports ok")
""")

md(r"""
## Run Configuration
Everything you may want to change lives in this one cell.
""")
code(r"""
START = "2010-01-01"        # first date to download
USE_CACHE = False           # True = reuse artifacts/sources.pkl instead of re-downloading (handy when iterating)
N_TEST = 252                # final held-out window: ~1 trading year the models never see until the end
RUN_EXPERIMENTS = True      # False = skip the ~3 min experiment search and use paun_ml/model_config.json as-is
SRC_CACHE = Path("artifacts/sources.pkl")
print(f"horizon = {HORIZON} sessions | 'big move' = {LABEL_K} x expected volatility | held-out = last {N_TEST} sessions")
""")

# ============================================================================================ DATA COLLECTION
md(r"""
# 2. Data Collection

## Download Sources
Free public data, **no API keys**. `download_sources` returns each series *untouched* — every one on its own calendar
and with its own gaps — so we can inspect and clean it ourselves below.

| Series | Source | What it is | Why it matters for gold |
|---|---|---|---|
| `xau` | Yahoo `GC=F` | COMEX gold futures (close) — our proxy for spot | the thing we predict |
| `dxy` | Yahoo `DX-Y.NYB` | US Dollar Index | stronger dollar usually weighs on gold |
| `us10y` | Yahoo `^TNX` | nominal 10-year US yield (%) | rates = opportunity cost of holding gold |
| `real10y` | FRED `DFII10` | 10-year **real** (TIPS) yield (%) | gold's classic driver |
| `gvz` | Yahoo `^GVZ` | CBOE Gold Volatility Index | what options traders expect |
| `oil` | Yahoo `CL=F` | WTI crude oil | inflation / risk proxy |
| `usdmyr` | Yahoo `MYR=X` | USD→MYR exchange rate | the ringgit price Malaysians see |
| `sp500` | Yahoo `^GSPC` | S&P 500 | risk-on / risk-off |

*Caveat:* Yahoo access through `yfinance` is unofficial and can break or rate-limit; futures differ slightly from spot and
jump a little when contracts roll over.
""")
code(r"""
if USE_CACHE and SRC_CACHE.exists():
    sources = pd.read_pickle(SRC_CACHE)
else:
    sources = data.download_sources(START)
    SRC_CACHE.parent.mkdir(exist_ok=True)
    pd.to_pickle(sources, SRC_CACHE)
print({k: len(v) for k, v in sources.items()})
""")

# ============================================================================================ DATA PREPARATION
md(r"""
# 3. Data Preparation
*Just looking at the data — plain pandas, nothing is changed yet.*

## Shape, Date Range & Gaps
""")
code(r"""
overview = pd.DataFrame({
    k: {"rows": len(s), "first date": s.index.min().date(), "last date": s.index.max().date(),
        "missing values": int(s.isna().sum()), "duplicate dates": int(s.index.duplicated().sum()),
        "dates sorted": s.index.is_monotonic_increasing}
    for k, s in sources.items()
}).T
overview
""")

md(r"""
## Side-by-Side View (Untouched)
`pd.concat` on a *union* of all calendars. The NaNs you see are not bad data — markets simply close on different days
(US holidays, Asian holidays, FRED publishes only weekdays…).
""")
code(r"""
naive = pd.concat(sources, axis=1)
print(naive.shape)
display(naive.head(8))
display(naive.tail(5))
naive.info()
""")

md(r"""
## Summary Statistics
""")
code(r"""
naive.describe().T.round(3)
""")

md(r"""
## Plot Every Series
""")
code(r"""
axes = naive.plot(subplots=True, figsize=(11, 15), lw=1.1, legend=False, color=ev.BLUE, sharex=True)
for ax, name in zip(axes, naive.columns):
    ax.set_ylabel(name, rotation=0, ha="right", va="center", fontsize=9)
    ax.grid(color=ev.GRID, lw=0.6)
plt.tight_layout(); plt.show()
""")
md(r"""
Gold's price level trends up over 15 years, as do equities; yields and the dollar wander. **Raw levels are not stationary**:
a model fed raw prices would simply learn "prices go up". That is why the Feature Engineering section works with returns
and ratios.
""")

md(r"""
## Daily Changes & Distribution
Exploration only (we forward-fill purely for plotting here; the real cleaning comes next).
""")
code(r"""
chg = naive.ffill().pct_change().replace([np.inf, -np.inf], np.nan)
chg["us10y"] = naive["us10y"].ffill().diff()          # yields are already in %, so use point changes
chg["real10y"] = naive["real10y"].ffill().diff()
chg = chg.clip(-0.2, 0.2)                             # only so the histograms stay readable
chg.hist(bins=80, figsize=(11, 7), color=ev.BLUE, grid=False)
plt.tight_layout(); plt.show()
print("Excess kurtosis (0 = bell curve; large = fat tails, i.e. surprise moves are more common than a bell curve says):")
display(chg.kurt().round(1).to_frame("excess kurtosis").T)
""")

md(r"""
## Correlations Between Drivers
Correlation of daily changes. Weak or unstable correlations between gold and its drivers are the first hint that
prediction will be hard.
""")
code(r"""
def heatmap(df, title, figsize=(6.5, 5.5)):
    fig, ax = plt.subplots(figsize=figsize, facecolor=ev.SURFACE, layout="constrained")
    im = ax.imshow(df.values, cmap="RdBu_r", vmin=-1, vmax=1)
    ax.set_xticks(range(len(df.columns)), df.columns, rotation=60, ha="right", fontsize=8)
    ax.set_yticks(range(len(df.index)), df.index, fontsize=8)
    if len(df) <= 12:
        for i in range(len(df)):
            for j in range(len(df.columns)):
                ax.text(j, i, f"{df.values[i, j]:.2f}", ha="center", va="center", fontsize=7.5)
    fig.colorbar(im, shrink=0.8); ax.set_title(title, loc="left", fontsize=10.5)
    plt.show()

heatmap(chg.corr(), "Correlation of daily changes")
""")

# ============================================================================================ DATA CLEANING
md(r"""
# 4. Data Cleaning
*Hand-made, step by step, with before/after counts. At the end we prove our result equals the package function
`data.align_and_clean`, so the production pipeline does exactly this.*

## Missing Values
""")
code(r"""
print("Missing values per series on the union calendar:")
display(naive.isna().sum().to_frame("missing").T)
print("Share missing by year (only the early years of GVZ/real yields would indicate a real problem):")
(naive.isna().groupby(naive.index.year).mean() * 100).round(1)
""")

md(r"""
## Duplicate & Unsorted Dates
Both would silently corrupt rolling windows and "shift" operations. We checked them in the overview; this makes it an explicit gate.
""")
code(r"""
for k, s in sources.items():
    assert s.index.is_monotonic_increasing and not s.index.has_duplicates, f"{k}: fix the index first"
print("all series: sorted, no duplicate dates")
""")

md(r"""
## Aligning to Gold's Trading Days
Gold is the series we predict, so **one row = one gold trading session**. Every other series is reindexed onto gold's calendar.
""")
code(r"""
gold_idx = sources["xau"].dropna().index
aligned = pd.DataFrame({k: s.reindex(s.index.union(gold_idx)).reindex(gold_idx) for k, s in sources.items()})
print(aligned.shape, "- rows = gold sessions")
aligned.isna().sum().to_frame("missing after alignment").T
""")

md(r"""
## Filling Gaps (Forward-Fill Only)
A holiday means "the last known value is still the latest information", so carrying it forward is honest. **Back-filling
would be cheating**: it copies the future into the past. The 5-session limit stops a dead feed from being carried forward forever.
""")
code(r"""
filled = pd.DataFrame({
    k: s.reindex(s.index.union(gold_idx)).ffill(limit=5).reindex(gold_idx) for k, s in sources.items()
})
pd.DataFrame({"missing before": aligned.isna().sum(), "missing after": filled.isna().sum()}).T
""")

md(r"""
## Lookahead Guard (FRED Lag)
FRED labels each value with the day it *describes*, but publishes it the **next morning**. Using the day-*t* value on day *t*
would be a one-day peek into the future, so we shift it by one session.
""")
code(r"""
clean = filled.copy()
clean["real10y"] = clean["real10y"].shift(1)
display(pd.DataFrame({"as published (dated t)": filled["real10y"].iloc[1000:1004],
                      "what the model may use on day t": clean["real10y"].iloc[1000:1004]}))
""")

md(r"""
## Anomalies
Not everything odd is an error — we *look*, then decide.
""")
code(r"""
print("WTI oil traded at a NEGATIVE price in April 2020 (a real event). log-returns would break, so the feature uses a clipped simple return:")
display(clean.loc[clean["oil"] <= 0, ["oil"]])

print("Largest one-day gold moves (real events like 2020-03 and 2026-01, or futures-roll jumps?):")
gold_move = clean["xau"].pct_change().abs().nlargest(8)
display((gold_move * 100).round(2).to_frame("abs move %"))
""")
code(r"""
quality = data.data_quality_report(clean)
quality
""")
md(r"""
*Reading the table:* `longest_stale` = longest run of an unchanged value (a frozen feed would show here);
`extreme_moves` = daily changes beyond 6 standard deviations (spikes or genuine shocks — worth a look, not an automatic delete).
""")

md(r"""
## Final Clean Dataset
""")
code(r"""
pd.testing.assert_frame_equal(clean, data.align_and_clean(sources))   # hand-made == package function
raw = clean
print("hand-made cleaning == data.align_and_clean  ✓")
raw.info()
raw.tail(3)
""")

# ============================================================================================ FEATURE ENGINEERING
md(r"""
# 5. Feature Engineering

## Why Returns & Ratios, Not Prices
A model needs inputs whose meaning stays the same over time. "+2% in 5 days" means the same in 2012 and 2026; "$4,000" does not.
Every feature is a return, ratio or change (*stationary*). Each feature at day *t* uses **only data up to the close of day *t***.

## Feature Catalogue
""")
code(r"""
groups = {f: g for g, fs in F.FEATURE_GROUPS.items() for f in fs}
pd.DataFrame({"group": [groups[f] for f in F.ALL_FEATURES], "meaning": [F.FEATURE_DOC[f] for f in F.ALL_FEATURES]},
             index=F.ALL_FEATURES).style.set_properties(subset=["meaning"], **{"text-align": "left"})
""")

md(r"""
## Volatility-Normalised Features
A "+2% in 5 days" is a huge move in a calm market and routine in a wild one. The trees cannot divide two columns themselves, so
we also provide momentum and trend measured **in units of expected volatility** (`sigma_5d`, `ret_5d_z`, `ma20_z` …).
""")
code(r"""
feats = F.compute_features(raw)
feats[["ret_5d", "ret_5d_z", "sigma_5d"]].dropna().describe().T.round(4)
""")

md(r"""
## Feature Preview
""")
code(r"""
display(feats.dropna().describe().T.round(3))
feats.tail(3).T.round(4)
""")

md(r"""
## Redundancy Check
Highly correlated features carry the same information. That is fine for trees but it spreads importance between twins, which matters
when we explain the model later.
""")
code(r"""
fc = feats.dropna().corr()
pairs = fc.where(np.triu(np.ones(fc.shape), 1).astype(bool)).stack().abs().sort_values(ascending=False)
display(pairs.head(10).round(2).to_frame("|correlation|"))
heatmap(fc, "Feature correlations", figsize=(9, 7.5))
""")

md(r"""
## No-Lookahead Guarantee
Compute the features on a truncated history and on the full one: the overlapping rows must be *identical*. If any feature peeked into the future, they would differ.
""")
code(r"""
short = F.compute_features(raw.iloc[:-60])
pd.testing.assert_frame_equal(short, feats.iloc[:-60])
print("features on truncated history == features on full history  ✓  (no lookahead)")
""")

# ============================================================================================ TARGET LABELLING
md(r"""
# 6. Target Labelling & Train/Test Split

## Volatility-Scaled Labels
For every past day we look **5 trading sessions ahead** and ask: did gold fall or rise by *more than 0.75 × the move we expected*
(its EWMA volatility)?

| Class | Name | Rule |
|---|---|---|
| 0 | Bearish Retracement | forward 5-session return < −0.75 σ |
| 1 | Sideways Consolidation | in between |
| 2 | Bullish Breakout | forward 5-session return > +0.75 σ |

**Why scaled and not a fixed ±1.5%?** A fixed threshold makes the class mix depend on volatility: in wild years most weeks are
"breakouts", in calm years almost none. The model then mostly re-learns volatility. Scaling the threshold by current volatility keeps
the classes balanced, so the model has to find real *directional* information. The threshold is computed **only from past data** (tests enforce it).
""")
code(r"""
labels = F.compute_labels(raw)
example = labels.dropna().iloc[[1500]]
example.assign(threshold_pct=example["threshold"] * 100, fwd_ret_pct=example["fwd_ret"] * 100)[
    ["sigma", "threshold_pct", "fwd_ret_pct", "regime"]].round(4)
""")
md(r"""
Read the row: if `fwd_ret_pct` is beyond ± `threshold_pct` the regime is 0 or 2; otherwise 1.
""")

md(r"""
## Threshold Over Time
""")
code(r"""
ev.fig_threshold(labels)
""")

md(r"""
## Class Balance
""")
code(r"""
df = F.training_frame(raw)                       # only rows with complete features AND a known outcome
y_all = df["regime"].astype(int)
print(f"{len(df)} labelled rows: {df.index[0].date()} -> {df.index[-1].date()}")
ev.fig_class_mix(y_all)
""")
code(r"""
ev.fig_class_mix_by_year(y_all)
""")
md(r"""
With a fixed ±1.5% threshold these yearly bars swung widely (2017 and 2025–26 looked "bullish-heavy", 2018–19 "sideways-heavy").
Scaled labels keep them within a band — the intended effect.
""")

# ============================================================================================ SPLIT
md(r"""


## Train / Test Split
Shuffling rows and testing on a random 20% is **wrong for time series** — the model would train on 2024 to "predict" 2019.
We always train on the past and test on the future:

```
oldest ─────────────────────────────────────────────────────────► newest
[ train + 5-fold walk-forward CV ........ ][ 5-row gap ][ FINAL TEST YEAR ]
                                              ▲                 ▲
                labels look 5 days ahead, so we drop        never touched until the very end:
                5 rows to prevent any overlap/leak          the judge of the final model
```
""")
code(r"""
X_all = df[F.ALL_FEATURES]                       # every candidate feature; experiments choose a subset
n_tr = tr.split_sizes(len(df), N_TEST)
print(f"train + CV : {df.index[0].date()} -> {df.index[n_tr - 1].date()}  ({n_tr} rows)")
print(f"gap        : {HORIZON} rows")
print(f"final test : {df.index[-N_TEST].date()} -> {df.index[-1].date()}  ({N_TEST} rows)")
""")

# ============================================================================================ MODEL TRAINING
md(r"""
# 7. Model Training

## i. Baseline: Climatology
"Climatology" = ignore all inputs and always predict the historical class mix. It sounds silly but is hard to beat in noisy markets,
so it is our yardstick. Scores use **log-loss**: it grades the *probabilities*, punishing confident wrong answers hard.
""")
code(r"""
prior = tr.class_prior(y_all.iloc[:n_tr])
print("climatology probabilities (bearish / sideways / bullish):", prior.round(3))
for p in (0.9, 0.5, 0.2, 0.05):
    print(f"if you said {p:>4.0%} for what actually happened -> loss {-np.log(p):.2f}")
""")

md(r"""
## ii. Model A: CatBoost Regime Model
**Why CatBoost?** Gradient-boosted trees are the strongest, most stable choice for small noisy tabular data (~4,000 rows). It trains in
seconds and exports to a ~0.5 MB ONNX file the browser can run. Settings are **fixed and conservative** (shallow trees, strong regularisation).

**Walk-forward CV:** 5 rounds; each trains on everything before a cutoff and is scored on the *next* unseen stretch (a growing window).
""")
code(r"""
base_cols = F.BASE_FEATURES
folds, oof = tr.walk_forward_cv(X_all[base_cols], y_all, n_tr)           # C1: original 18 features, scaled labels
pd.DataFrame(folds)[["fold", "val_start", "val_end", "train_rows", "logloss", "logloss_prior", "beats_prior"]].round(4)
""")
code(r"""
ev.fig_cv_improvement(folds)
""")
md(r"""
Above zero = better than climatology. With scaled labels the first plain model is roughly *as good as* the baseline: little direction is
extractable from these inputs. The experiments below try to improve it **without fooling ourselves**.
""")

md(r"""
## iii. Model A Experiments

### a) Protocol & Candidates
Pre-registered protocol (fixed *before* looking at results): candidates are compared **only on the walk-forward folds**; the held-out year is opened once, for the winner.
A candidate needs to beat climatology in **≥ 3 of 5 folds**; then the highest mean improvement wins (ties → simpler). Each candidate also
gets a **block-bootstrap 90% interval** — if it includes 0, the gain could be luck.

| ID | Candidate |
|---|---|
| C1 / C2 | original 18 features / + volatility-normalised (24) |
| C3 | feature-group ablation: drop families whose removal helps |
| C5 | small regularisation grid (depth × L2) |
| C4 | best of the above, blended with climatology (`p = w·p_model + (1−w)·prior`, `w` learned on an inner split) |
""")
code(r"""
if RUN_EXPERIMENTS:
    res = ex.run_experiments(X_all, y_all, n_tr)
else:
    res = None
    print("skipped - using paun_ml/model_config.json:", {k: load_config()[k] for k in ("candidate", "shrink_mode", "qualified")})
""")
code(r"""
if res:
    display(pd.DataFrame([{"ID": c["id"], "candidate": c["label"], "features": c["n_features"],
                           "folds beating": f"{c['folds_beating']}/5", "mean gain": round(c["mean_gain"], 4),
                           "90% interval": f"[{c['ci_low']:+.4f}, {c['ci_high']:+.4f}]", "ECE": round(c["ece"], 3)}
                          for c in res["candidates"]]))
    display(ex.fig_experiments(res["candidates"], res["winner"]["id"]))
""")
md(r"""
### b) What the Ablation Tells Us
Removing a feature group that *hurts* the score (negative delta) shows which families carry signal; removing one that *helps* (positive delta) suggests it adds noise.
""")
code(r"""
if res:
    display(pd.DataFrame(res["ablation"]).sort_values("delta", ascending=False).round(4))
""")

md(r"""
### c) Winner Selection
The selection rule is applied mechanically. **Read the interval:** a winner whose 90% interval includes 0 can pass the fold rule but is
statistically indistinguishable from "always predict the base rates" — ship rule A4 (below) will then block it.
""")
code(r"""
if res:
    w = res["winner"]
    print(f"winner: {w['id']} - {w['label']}")
    print(f"qualified under the rule (>= 3/5 folds): {res['qualified']}")
    print(f"mean gain {w['mean_gain']:+.4f}, 90% interval [{w['ci_low']:+.4f}, {w['ci_high']:+.4f}]  ->",
          "excludes 0" if w["ci_low"] > 0 else "INCLUDES 0: not distinguishable from luck")
    cfg = ex.config_from(res, X_all, y_all)       # (writing it to model_config.json is done by `python -m paun_ml.experiments`)
else:
    cfg = load_config()
print({k: cfg[k] for k in ("candidate", "shrink_mode", "shrink_w")}, "| features:", len(cfg["features"]))
""")

md(r"""
## iv. Model B: Volatility Bands
Gold's *direction* is nearly unpredictable, but its **volatility clusters**: calm periods follow calm periods, wild follow wild. So we forecast **how far** price can plausibly move:

1. Forecast the variance of the next 5 days with **EWMA** (exponentially weighted average of squared returns) or **GARCH(1,1)**
   (today's variance = a floor + a reaction to the latest shock + memory of yesterday's variance).
2. Divide historical 5-day returns by that spread -> "standardised" returns that look alike in calm and wild times; take their **10 / 50 / 90 % quantiles**
   (real quantiles, not a bell curve, to keep fat tails).
3. Band = `spot × exp(√variance × quantile)`.
""")
code(r"""
be = bands.evaluate_test_window(raw, N_TEST)       # fit before the test year (with a gap), score on the test year
params_b, _ = bands.run(raw, N_TEST)
pd.DataFrame(params_b["garch"], index=["GARCH(1,1) fit"]).round(6)
""")
code(r"""
print("standardised quantiles used for the bands (EWMA):", {k: round(v, 3) for k, v in params_b["quantiles_ewma"].items()})
""")

# ============================================================================================ EVALUATION
md(r"""
# 8. Evaluation

## i. Model A: Regime Classifier

### a) Held-Out Year
Train the chosen configuration on everything before the gap, score on the untouched final year.
""")
code(r"""
features, params = cfg["features"], catboost_params(cfg)
X = df[features]
fit_predict = tr.shrink_fit_predict(params) if cfg["shrink_mode"] == "inner" else tr.catboost_fit_predict(params)
folds, oof = tr.walk_forward_cv(X, y_all, n_tr, fit_predict=fit_predict)
test_m, test_df, _ = tr.holdout_test(X, y_all, n_tr, N_TEST, fit_predict)
pd.Series(test_m).round(4)
""")
md(r"""
Compare `logloss` with `logloss_prior`. The gap is small: the model is **close to climatology**, which is what an honest model of a noisy market looks like.
""")

md(r"""
### b) Calibration
Points on the dashed diagonal are perfect. *Calibration matters more than accuracy here*: the app shows probabilities to people.
""")
code(r"""
ev.fig_reliability(oof)
""")

md(r"""
### c) Confusion Matrix
""")
code(r"""
ev.fig_confusion(test_df)
""")
md(r"""
A model close to climatology mostly answers "sideways" (the most common class) — accuracy then looks decent but only mirrors the base rate. That is why we judge on log-loss and calibration, not accuracy.
""")

md(r"""
### d) Rolling Log-Loss
""")
code(r"""
ev.fig_rolling_logloss(oof, test_df)
""")

md(r"""
## ii. Model B: Price Bands

### a) Coverage & Pinball Loss
Coverage: the real price should land inside the P10–P90 band ~80% of the time. Pinball loss (lower is better) is compared with a **constant-volatility baseline** that ignores current conditions.
""")
code(r"""
pd.DataFrame(be["report"]).T.drop(index="test_rows").round(5)
""")
code(r"""
ev.fig_bands(be)
""")
md(r"""
Orange dots = the price escaped the band. They cluster in violent moves (volatility can jump faster than any model reacts) — expected, and the reason the UI must present these as *ranges, not guarantees*.
""")

md(r"""
## iii. Ship Verdict
The rules live in one place (`evaluate.acceptance`, thresholds at the top of `evaluate.py`), so the decision is mechanical.

* **Model A needs all of:** A1 beats climatology on the held-out year · A2 beats it in ≥ 3 of 5 folds · A3 calibration error ≤ 0.05 · **A4 the gain is statistically real** (the 90% block-bootstrap interval excludes 0).
* **Model B needs:** B1 band coverage within 80% ± 5 · B2 pinball loss beats the constant-volatility baseline.
""")
code(r"""
verdict = ev.acceptance(folds, oof, test_m, be["report"])
display(pd.DataFrame(verdict["checks"])[["id", "desc", "value", "rule", "passed"]])
s = verdict["summary"]
print("Model A ships:", s["model_a_ship"], "| Model B ships:", s["model_b_ship"], "| best band:", s["recommended_band"].upper())
lo, hi = s["oof_gain_ci90"]
print(f"Statistical evidence of skill: 90% interval of the out-of-fold gain = [{lo:+.4f}, {hi:+.4f}] ->",
      "excludes 0" if s["skill_evidence"] else "INCLUDES 0 (passing the rules is not the same as proven skill)")
""")

# ============================================================================================ XAI
md(r"""
# 9. Explainable AI

**SHAP** explains each forecast *exactly* for tree models: `raw score of a class = baseline + Σ (push from each input)`, and the probabilities are the softmax of those scores.
Units are *log-odds*: +0.3 on "Bullish" multiplies its odds by about e^0.3 ≈ 1.35, all else equal.

> **Limits — read this first.** SHAP shows what the *model leaned on*, not what *caused* gold to move. An input can matter to the model because it correlates with something else. Treat drivers as "what the model saw", not as news.

## i. Fit the Production Model & Verify SHAP
""")
code(r"""
prod = tr.train_production(X, y_all, params)
shap, base = explain.shap_values(prod, X)
check = explain.probabilities_from_shap(shap, base)
print("additivity check: max |SHAP-rebuilt probability - model probability| =", float(np.abs(check - prod.predict_proba(X)).max()))
gi = explain.global_importance(shap, features)
""")

md(r"""
## ii. Global Drivers
""")
code(r"""
explain.fig_global_importance(gi)
""")
md(r"""
Expect the **volatility** family (`vol_20d`, `sigma_5d`, `bb_bandwidth`, `gvz_level`) near the top: when markets are wild, big moves in *either* direction are more likely, so these inputs mostly shift the odds between "sideways" and the tails.
""")

md(r"""
## iii. Direction of Effect
Each dot is one day: the input's value (x) against its push on one outcome (y). Above zero raises that outcome's odds.
""")
code(r"""
explain.fig_dependence(shap, X, gi, cls=2)
""")

md(r"""
## iv. Stability Across Folds
If the top drivers change in every period, the model is probably fitting noise. Fold models explain their own **out-of-sample** rows here.
""")
code(r"""
stab = explain.driver_stability(X, y_all, n_tr, params)
explain.fig_stability(stab)
""")

md(r"""
## v. Explaining Today's Forecast
The newest session has no label yet, but it has features: we can forecast it and explain it.
""")
code(r"""
live = F.compute_features(raw)[features].iloc[[-1]]
e = explain.explain_row(prod, live)
print("as of", live.index[0].date(), "| probabilities:", dict(zip(F.CLASS_NAMES, e["probs"].round(3))))
print("today's 'big move' threshold:", round(float(100 * LABEL_K * F.expected_sigma(raw).iloc[-1]), 2), "% over the next 5 sessions")
explain.fig_waterfall(e)
""")
code(r"""
pd.DataFrame(explain.top_drivers(prod, live, n=3))[["feature", "direction", "class", "effect", "value"]]
""")

md(r"""
## vi. Explaining a Band
A band explains itself: **width = expected volatility × (z90 − z10)**. It breathes with volatility — narrow in calm markets, wide in wild ones.
""")
code(r"""
explain.fig_band_width(raw, params_b)
""")

# ============================================================================================ EXPORT
md(r"""
# 10. Export & Deployment

## ONNX Export & Parity Check
The model above is already refit on **all** labelled data. CatBoost writes an **ONNX** file (a portable model format) that the browser can run with `onnxruntime-web`. Two details are handled for you:

* CatBoost's ONNX ends in a *ZipMap* node returning a list of dictionaries — a type JavaScript cannot receive. `strip_zipmap` rewires the output into a plain `[N, 3]` float tensor.
* We **verify** the ONNX file reproduces CatBoost's probabilities (max difference ~1e-7).

Files land in `artifacts/models_demo/` so you cannot overwrite the app's files by accident.
""")
code(r"""
export = tr.export_onnx(prod, Path("artifacts/models_demo"), X.iloc[-N_TEST:])
print({k: export[k] for k in ("max_abs_diff", "zipmap_stripped")})
""")

md(r"""
## Shipped Files
The CLI chains everything above, writes the real files, and regenerates the evaluation report:

```
python -m paun_ml.experiments --use-cache          # (optional) re-run the search, rewrites model_config.json
python -m paun_ml.train_regime --models-dir ../public/models
```

| File | What it is |
|---|---|
| `public/models/regime.onnx` | Model A for the browser (input `features` float32 `[N, n_features]`, output `probabilities` `[N, 3]`) |
| `public/models/model_meta.json` | feature order, class names, metrics, shrink weight, and the ship verdict the app reads |
| `public/models/bands_params.json` | Model B parameters (GARCH/EWMA + quantiles); the bands are computed in TypeScript |
| `ml/models/regime.cbm` | native CatBoost model — stays on the server side; the daily job uses it for SHAP drivers |
| `ml/reports/latest.md` | this evaluation, regenerated on every run |
""")
code(r"""
ship = Path("../public/models")
if ship.exists():
    display(pd.DataFrame([{"file": p.name, "KB": round(p.stat().st_size / 1024, 1)} for p in sorted(ship.iterdir())]))
""")

md(r"""
## Daily Snapshot Preview
`python -m paun_ml.snapshot` produces the one JSON file the app fetches daily: regime probabilities, today's "big move" threshold, SHAP drivers, bands and the data the TypeScript port needs.
""")
code(r"""
preview = {
    "asOf": str(live.index[0].date()),
    "regime_probs": dict(zip(F.CLASS_NAMES, e["probs"].round(4).tolist())),
    "threshold_pct": round(float(100 * LABEL_K * F.expected_sigma(raw).iloc[-1]), 3),
    "drivers": explain.top_drivers(prod, live, n=3),
}
preview
""")

# ============================================================================================ CONCLUSION
md(r"""
# 11. Conclusion

## Results Summary
""")
code(r"""
print(f"Model A  candidate {cfg['candidate']} | folds beating climatology: {s['folds_beating_prior']}/5 | held-out log-loss {test_m['logloss']:.4f} vs climatology {test_m['logloss_prior']:.4f}")
print(f"         ECE {s['oof_ece']:.3f} | rules say ship: {s['model_a_ship']} | evidence of real skill: {s['skill_evidence']}")
print(f"Model B  {s['recommended_band'].upper()} bands | coverage {be['report'][s['recommended_band']]['coverage_p10_p90']:.1%} (ideal 80%) | rules say ship: {s['model_b_ship']}")
""")
md(r"""
**How to read this honestly:** volatility-scaled labels fixed the main flaw (the class mix no longer tracks volatility) and the price bands are well calibrated — that part is solid. Direction is genuinely hard: the regime model is *close to* climatology, clears
A1–A3 but **fails A4**: its gain cannot be statistically separated from luck, so Model A is **not shipped** and the app shows the price bands only. If a future model passes A4, regime probabilities should still be presented as *context* ("slightly more/less likely than usual"), never as a trading signal.

## Next Steps
1. **Find a real directional edge** (new data, not more tuning) — until a model passes A4 the app ships bands only.
2. **Port features + bands to TypeScript** with a golden-fixture parity test against this Python code.
3. **Benchmark against pretrained forecasters** (Chronos / TimesFM / Moirai / Kronos) on the same folds and test year — an internal subproject; recent data is the fairest because older prices may be in their training sets.
4. **More signal, not more models:** ETF flows, positioning (CFTC), real-time central-bank data — quarterly or lagged sources fit a 5-day horizon poorly.
5. **Retrain monthly**; commit `public/models/*` and `ml/reports/`.

## Glossary
| Term | Plain meaning |
|---|---|
| **Climatology** | The no-skill baseline: always predict the historical class frequencies. |
| **Log-loss** | Score for probability forecasts; heavily punishes confident misses. Lower = better. |
| **Brier score** | Mean squared error of the probabilities. Lower = better. |
| **Walk-forward CV** | Train on the past, test on the next unseen stretch, repeat with a growing window. |
| **Purge gap** | Rows dropped between train and test because labels look ahead and would overlap. |
| **Stationary** | Statistics (average, spread) stay roughly the same over time — needed for a model to generalise. |
| **EWMA / GARCH** | Ways to forecast volatility from recent shocks; both capture volatility clustering. |
| **Volatility-scaled label** | "Big move" defined relative to current volatility instead of a fixed percentage. |
| **Calibration / ECE** | Do "40%" forecasts happen ~40% of the time? ECE = average gap (0 = perfect). |
| **Coverage** | Share of outcomes inside the P10–P90 band (ideal 80%). |
| **Pinball loss** | Scoring rule for quantile forecasts; lowest when the quantile is exactly right. |
| **Block bootstrap** | Resampling in chunks of consecutive days to get an honest uncertainty interval for a score. |
| **SHAP** | Exact decomposition of a tree model's output into a push from each input (log-odds). |
| **Shrinkage** | Blending the model with climatology to cure overconfidence: `p = w·model + (1−w)·base rate`. |
| **ONNX** | Portable model file format that runs in the browser (`onnxruntime-web`). |
| **Train/serve skew** | Model trained on inputs prepared one way, served inputs prepared another — silent failure. |
""")

nb["cells"] = cells
nb["metadata"] = {
    "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
    "language_info": {"name": "python"},
}
nbf.write(nb, "colab.ipynb")
print("wrote colab.ipynb with", len(cells), "cells")
