# Paun ML workspace

Offline Python that trains, evaluates and **explains** the gold **regime probabilities** and **price bands** shown in
the app. Why this approach: see `../PLAN.md` (Phase ML). **Start with `colab.ipynb`** — a segmented, explained
walkthrough (1 Setup → 2 Data Collection → 3 Data Preparation → 4 Data Cleaning → 5 Feature Engineering →
6 Target Labelling & Train/Test Split → 7 Model Training → 8 Evaluation → 9 Explainable AI → 10 Export & Deployment →
11 Conclusion; numbered `#` phases, short `##` steps, lettered `###` sub-items) that calls the same code the CLI and the
daily GitHub Action use.

## What is here

| Piece | File | Output |
|---|---|---|
| Shared tunables (horizon, label multiplier, burn-in) | `paun_ml/constants.py` | — |
| Data: download untouched sources → align & clean (no API keys) + quality report | `paun_ml/data.py` | aligned daily closes |
| Shared volatility estimate (EWMA), used by labels AND bands | `paun_ml/vol.py` | — |
| Features & volatility-scaled labels (single source of truth) | `paun_ml/features.py` | 24 candidate features, 3-class regime |
| Chosen Model A configuration | `paun_ml/model_config.py`, `model_config.json` | features / params / shrinkage |
| Experiments (feature sets, ablation, regularisation, shrinkage) | `paun_ml/experiments.py` | `reports/experiments.md`, `model_config.json` |
| Model A — CatBoost regime | `paun_ml/train_regime.py` | `public/models/regime.onnx`, `model_meta.json`, `ml/models/regime.cbm` |
| Model B — GARCH/EWMA bands | `paun_ml/bands.py` | `public/models/bands_params.json` |
| Evaluation, charts, ship rules | `paun_ml/evaluate.py` | `reports/latest.md` + `reports/figures/*.png` |
| Explainable AI (SHAP) | `paun_ml/explain.py` | report section; `forecast.drivers` in the snapshot |
| Daily snapshot (what the app fetches) | `paun_ml/snapshot.py` | `market-snapshot.json` (→ `data` branch) |
| Guided walkthrough (generated) | `colab.ipynb` ← `tools/make_notebook.py` | edit the generator, then re-run it |

## Run it

```sh
cd ml
uv venv --python 3.12 .venv && uv pip install --python .venv/Scripts/python.exe -r requirements.txt
.venv/Scripts/python.exe -m pytest -q                      # offline tests on synthetic data (~10 s)
.venv/Scripts/python.exe -m paun_ml.experiments            # (optional) search for a better Model A config (~3 min)
.venv/Scripts/python.exe -m paun_ml.train_regime           # train + evaluate + explain + export (needs internet)
.venv/Scripts/python.exe -m paun_ml.snapshot --out artifacts/market-snapshot.json
.venv/Scripts/python.exe tools/make_notebook.py            # regenerate colab.ipynb after editing the generator
```

Use Python **3.12** (3.14 wheels for CatBoost/onnx lag). Training takes about a minute on a laptop CPU — no GPU.
Add `--use-cache` to reuse `artifacts/raw.csv` instead of downloading.

## Running in Colab

Colab begins as an empty machine, so the notebook's first cell needs the code:

1. **Push the repo to GitHub once** (`PravinRaj01/paun` is currently empty). It is public, so the notebook's
   `git clone` works without a token. If you make it private, add a fine-grained read-only token to Colab
   *Secrets* and clone with it.
2. Open `ml/colab.ipynb` in Colab (File → Open notebook → GitHub tab) and **Runtime → Run all** (~8 min).
3. **No GitHub?** Zip the `ml/` folder, upload it to Colab, unzip, `%cd ml`, and skip the clone in the first cell.
4. Download `public/models/*`, `ml/models/regime.cbm` and `reports/` and commit them.

## Running in Kaggle

The setup cell also detects Kaggle (`/kaggle/working`). Needed: **Settings → Internet → On** (data comes from Yahoo and FRED, and the repo
from GitHub; Kaggle requires a phone-verified account to enable internet). If the clone fails (repo empty/private), upload the `ml/` folder as a
Kaggle *Dataset*, add it to the notebook, and the cell copies it from `/kaggle/input`. Outputs land in `/kaggle/working` (download from the
notebook's Output tab). CPU is enough; leave the accelerator off. *Written from Kaggle's documented layout and not yet tested there.*

**Why a repo and not a standalone notebook?** The same feature code must run in training, the daily Action, the
tests, and (ported) in the browser. One shared package means they cannot drift apart. A drifting copy causes
*train/serve skew*: the model silently receives inputs computed differently from its training data.

## Labels: volatility-scaled "big moves"

Regime = what gold did over the next **5 sessions** relative to the move expected for *current* volatility:
Bearish if it fell by more than **0.75 × σ**, Bullish if it rose by more than 0.75 × σ, otherwise Sideways, where σ is the
EWMA forecast of the next-5-session volatility (`vol.py`; the same EWMA sizes the price bands). A fixed ±1.5% rule made the class
mix follow volatility (wild years = "breakouts"), so the model mostly re-learned volatility. Scaling keeps the classes
balanced. Thresholds use only past data (`tests/test_features.py`); today's threshold is published in the snapshot as
`forecast.threshold_pct` for UI copy such as "Bullish = a rise of more than 2.1% this week".

## How evaluation works

```
[ train + 5-fold walk-forward CV ........ ][ 5-row gap ][ final test year (252 rows) ]
```

* **Never shuffled.** Every fold trains on the past and tests on the following unseen stretch.
* **5-row purge gap.** Labels look 5 sessions ahead; without the gap, train and test outcomes would overlap.
* **Fixed hyper-parameters, no early stopping on validation data**, so fold scores are not tuned on what they score.
* **Baseline = climatology**: always predict the historical class mix. A model must beat it to be worth anything.
* **Experiments are pre-registered** (`experiments.py` docstring): compared on the folds only; the held-out year is opened once,
  for the winner. A candidate needs ≥ 3/5 folds, ties go to the simpler one, and every candidate gets a block-bootstrap 90%
  interval. Trying many candidates on the same folds inflates the best score, so read the interval, not just the point estimate.

| Metric | Meaning |
|---|---|
| Log-loss | Grades the probabilities; punishes confident wrong answers. Lower = better. ≈ 1.0 for climatology here. |
| Brier | Mean squared error of the probabilities. Lower = better. |
| ECE | Calibration: average gap between "said X%" and "happened X% of the time". 0 = perfect. |
| Coverage | Share of outcomes inside the P10–P90 band. Ideal 80%. |
| Pinball loss | Quantile-forecast score. Lower = better. |

### Ship / no-ship rules (one place to change: top of `paun_ml/evaluate.py`)

| ID | Rule |
|---|---|
| A1 | Held-out-year log-loss < climatology |
| A2 | Beats climatology in ≥ 3 of 5 walk-forward folds |
| A3 | Out-of-fold ECE ≤ 0.05 |
| A4 | The 90% block-bootstrap interval of Model A's out-of-fold gain over climatology excludes 0 (lower bound > 0) — added 2026-10-06 so a model cannot ship on luck |
| B1 | P10–P90 coverage within 80% ± 5 (held-out year; best of GARCH/EWMA) |
| B2 | Pinball loss < constant-volatility baseline |

Model A ships only if **all** A-checks (A1–A4) pass; otherwise the app hides regime percentages and shows only bands (the snapshot carries `forecast.regime_shipped = false` and `regime_probs = null`). Passing A1–A3 alone is not proof of skill: with weak signal and many candidates tried, a model can clear them by chance — A4 requires the gain to be statistically real. ONNX parity (max |diff| vs CatBoost < 1e-3 on ≥ 99.5% of
rows) is asserted during export.

## Explainable AI

`explain.py` uses CatBoost's built-in exact TreeSHAP: baseline + each input's push = the model's own output (a test checks the
additivity). The report and notebook show global drivers, direction of effect, **stability of the drivers across walk-forward folds**
(drivers that change every period are probably noise), a worked explanation of today's forecast, and why the price band has its
width. The daily snapshot adds `forecast.drivers`: the top 3 inputs behind today's most likely regime, in plain language.
**SHAP shows what the model leaned on, not what caused gold to move.**

## Conventions worth knowing

* One row = one gold session; horizon = **5 sessions** (~7 calendar days); features at row *t* use only data up to close *t*.
* `real10y` (FRED) is shifted one session: it is published the morning after its date.
* ONNX contract: input `features` float32 `[N, n_features]` in `model_meta.json → spec.features` order → output `probabilities`
  float32 `[N, 3]` (Bearish, Sideways, Bullish). CatBoost's ZipMap output is stripped so `onnxruntime-web` can return a plain tensor.
  If `model_meta.json → shrink.w < 1` the app blends: `p = w·p_onnx + (1−w)·shrink.prior`.
* Retrain monthly; commit `public/models/*`, `ml/models/regime.cbm`, `ml/paun_ml/model_config.json` and `ml/reports/`.
* Notebook tooling (dev only): `uv pip install nbformat nbconvert ipykernel` (Colab has them).
