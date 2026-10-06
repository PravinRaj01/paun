# Paun — Unified Plan (master reference)

Last updated: 2026-10-06 · Owner: Pravin Raj
Supersedes: `paun_upgrade_plan.md`, `paun_ml_architecture_plan.md`, the Gemini
`gold_dual_model_pipeline-v2.py` draft, and the old Lovable plans (now in `docs/archive/lovable-plans/`, history only).
First execution step saves this file into the repo as `PLAN.md`; that file becomes the
single reference and the older plan docs are moved to `docs/archive/`.

---

## STATUS (updated 2026-10-06) — ML-0 … ML-3 + snapshot built and run on live data

Done: PLAN.md, `ml/` workspace (data, features, CatBoost→ONNX, GARCH/EWMA bands, snapshot, Colab
notebook, 8 offline tests passing), `.github/workflows/market-snapshot.yml`, artifacts in
`public/models/` (`regime.onnx` 472 KB, `model_meta.json`, `bands_params.json`). Old plan docs in `docs/archive/`.

Measured results (4,011 rows 2010-10 → 2026-09, last 252 sessions held out):
- **ONNX delivery de-risked**: CatBoost's ONNX ends in a ZipMap that ort-web cannot return → stripped
  in `strip_zipmap()`; `onnxruntime-web` (WASM, Node spike) reproduces Python probabilities exactly.
- **Model A edge is weak and not yet proven**: beats class-prior log-loss in only 2/5 walk-forward
  folds (≈ tie in others). Held-out year "beats climatology" (1.138 vs 1.255) but accuracy is 37% and
  that year's regime shifted sharply, so treat as inconclusive. UI must show probabilities, not
  confident calls, until improved.
- **Bands work**: P10–P90 coverage on held-out year — EWMA 79.4%, GARCH 75.3% (ideal 80%), vs 49.8%
  for a constant-vol baseline. GARCH slightly better pinball loss; EWMA better calibrated.

**Evaluation & documentation pass (done):** `ml/paun_ml/evaluate.py` adds calibration (ECE), confusion matrix,
rolling log-loss, band chart, and explicit ship rules; `ml/reports/latest.md` is regenerated on every run;
`ml/colab.ipynb` is a guided walkthrough (executes end to end, 0 errors); code carries "why" comments;
15 offline tests pass. **Current verdict from the rules: Model A = DO NOT SHIP (beats climatology in 2/5 folds,
needs 3; calibration is fine, ECE 0.026) -> the app shows price bands only for now. Model B = SHIP (EWMA, coverage
79%, beats constant-vol).** ECE rule is measured on out-of-fold predictions (~3,300 rows), not the single test year.

**Model A fix round (2026-10-06):** labels changed from a fixed ±1.5% to **volatility-scaled (0.75 × expected 5-session σ)** —
class mix is now stable year to year and the old "baseline looks terrible in the held-out year" artefact is gone (climatology
log-loss 1.009 vs 1.255 before). Pre-registered experiments (C1–C5, `ml/reports/experiments.md`) picked **C5** (20 features, depth 4,
L2 30). Under rules A1–A3 it passed, but the edge is tiny (held-out log-loss 1.0044 vs 1.0088, 3/5 folds) and its 90% bootstrap interval
[−0.0095, +0.0134] **includes 0** — not distinguishable from "always predict base rates". **Owner decision: this is now ship rule A4**, so
**Model A = DO NOT SHIP (app shows bands only; snapshot `regime_shipped=false`), Model B = SHIP.** The
ablation shows the useful signal is mostly **volatility**, not direction. XAI (`ml/paun_ml/explain.py`) added; the snapshot now carries
`threshold_pct` and SHAP `drivers`. **UI: bands are the product; the regime card stays hidden until a model passes A4 (and even then it is context, never a trading signal).**
Notebook restructured into phase segments (`ml/tools/make_notebook.py` generates `ml/colab.ipynb`).

**ML-6 first slice shipped (2026-10-06):** TypeScript port of features + GARCH/EWMA bands (`src/lib/forecast/`) proven against Python by a
parity test on the snapshot itself (features to ~5e-7 = the file's own rounding, bands to the cent, GARCH variance to 1e-9); Vitest added
(`bun run test`, 13 tests). **Forecast card** on the Markets page (plain-language P10–P90 range, EN/BM, stale + offline badges, disclaimer) —
bands only, because rule A4 blocks regime %. Also fixed **G3** (chart now uses real daily closes; 1W/1M/1Y/5Y) and **G5** (new `"market"` spot
source: users who never set a price follow the latest published close; others get a one-tap "use market close" when >3% apart). Snapshot gained
`bandsParams`, `recommended_band`, 600-session history, `regime_shipped`. Not yet done: publish to the `data` branch (needs the repo pushed),
G4 (i18n of the rest of SpotChart), ONNX hook (only if a Model A passes A4).

Remaining ML work (before UI): (a) vol-scaled regime thresholds (fixed ±1.5% means very different things
at 10% vs 30% vol); (b) calibration of probabilities; (c) feature ablations (is real-yield / GVZ
adding anything?); (d) decide GARCH vs EWMA vs average for the published band; (e) TS port + golden
fixture parity test (ML-6).

## Context

Paun (பவுன் — Tamil for gold) is a Lovable-built, fully client-side gold investment & trade
assistant (TanStack Start + React 19 + Vite, SSR on Cloudflare via nitro; state in LocalStorage
via `src/lib/gold-store.tsx`). Pages: Landing (dot-matrix globe with live country prices),
Markets (spot chart + watchlist), Calculator (Buy vs Sell/Trade-in), Arbitrage (Active Trade
strip), Vault (P&L, export/import), bilingual EN/BM flip-book Gold Guide. All math in USD,
display converts via `settings.baseCurrency`.

The user has three overlapping plan sources and wants one plan, a gap review, and to **start
with the ML forecasting model**. Decisions confirmed by the user (2026-10-06):

| Decision | Choice |
|---|---|
| Model A | **CatBoost** 3-class regime classifier (Bearish / Consolidation / Bullish, ±1.5%) |
| Model B | **EWMA/GARCH volatility bands** × empirical return quantiles → P10/P50/P90 |
| TFT | Deferred to **Phase ML-4 challenger**; promoted only if it beats baseline out-of-sample |
| Delivery | **In-browser ONNX** (`onnxruntime-web`, model in `public/models/`), $0 server cost |
| Training | **Google Colab** running the repo's `ml/` scripts (Python 3.12) |

---

## Standing architecture constraints (apply to everything)

1. No login/database — state client-side (`src/lib/gold-store.tsx`). ML (1) and DCA (3C) stay
   client-side unless the user explicitly changes this. Static JSON files fetched from a CDN
   are allowed (no user data leaves the device).
2. All internal math in USD; display converts via `baseRateOf()` in `src/lib/gold.ts`.
   Trade fee/melting/asking inputs entered in base currency, stored as USD.
3. Melting cost applies **only** to Sell/Trade-in, never to buying.
4. PWA is manifest-only (`public/manifest.webmanifest`), no service worker (SSR stale-cache risk).
5. Watchlist adds come from `src/lib/country-catalog.ts` with Custom fallback; no flags.
6. UI copy bilingual via i18next (`src/locales/{en,ms}.json`, `useI18n()` from `src/lib/i18n.ts`);
   gold jargon (upah tukang, susut nilai, paun, mayam) locked from machine translation.
7. Landing map: vertical page scroll at home view, sideways one-finger explore, full pan/pinch
   only after zoom. Theme change: View Transition API radial reveal + reduced-motion fallback.
8. Lovable is fully decoupled (migration out in progress, see "Platform & deployment"). Keep `main` working and avoid force-pushing shared history. Automated data
   commits go to a **separate `data` branch**, never `main`.
9. **Vendor stack (fixed, no further decision needed):** Neon Postgres + Cloudflare Workers/Cron for any
   backend; **Gemini** and **Groq** for AI; **LangChain** only if a real multi-step chain/agent/RAG need
   appears. **Never** Lovable AI Gateway, Lovable Cloud or Supabase (no auth, db, edge functions or AI from
   them). Lovable is no longer part of the stack at all.
10. **Secrets never in the browser:** Gemini/Groq/Neon keys exist only as Cloudflare Worker secrets
    (`wrangler secret put`). The client calls our own Worker, never a vendor API directly.

---

## Gaps found in the current project & plans

**Blocking / do first**
- G1 ~~Repo has no commits~~ **Resolved:** the owner has since committed and pushed two commits to `origin/main` (`PravinRaj01/paun`). From here on:
  never rewrite pushed history (AGENTS.md); keep `main` working; automated data commits go only to the separate `data` branch.
- G2 **Local Python is 3.14** — CatBoost/PyTorch/arch wheels risky. Use Colab or a 3.12 venv.

**Bugs in `gold_dual_model_pipeline-v2.py` (will be rewritten, not patched)**
- Literal newlines inside `print("…")` → SyntaxError (lines 148, 181, 251, 351, 358).
- CV loop only keeps the last fold; no per-fold metrics; no purge gap for overlapping labels.
- `dropna()` drops the newest 7 rows (NaN forward target) → "live" inference uses data a week old.
- Horizon `shift(-7)` = 7 *trading* days ≈ 9–10 calendar days; copy says "7-day".
- `^TNX` is the **nominal** 10Y yield, not TIPS real yield (FRED `DFII10`). GVZ missing.
- Recent yfinance returns MultiIndex columns / no `Adj Close` → `data[key]` becomes a DataFrame.
- Model B: `random_split` on overlapping windows (leakage), unscaled raw price levels
  (non-stationary, can't extrapolate to new highs), val loader unused, no positional encoding,
  quantile crossing not enforced, "safety fallback" hides failures, fake `target_p10/p90`.
- `macro_drivers` in the payload are hard-coded strings, not model output.
- No baselines, no calibration check, no held-out test period.

**App gaps**
- G3 `SpotChart` draws **pseudo-random fake history** (`spotSeries()` in `src/lib/gold.ts:209`).
- G4 `SpotChart.tsx` has no i18n (Open/High/Low, footnote, `BASIS_LABEL`, `verdictOf` labels in English).
- G5 Spot defaults to a stale `2650`; FX rates are static catalog values; live spot needs the
  user's own goldapi.io key (free quota). No keyless fallback.
- G6 Vault import (`src/routes/vault.tsx:63`) silently ignores errors, **replaces** the whole
  vault instead of merging, no purity normalisation (pending item, extended).
- G7 `resetAll` doesn't clear vault/theme — confirm intended.
- G8 No test runner at all → ✅ done: Vitest with 54 TypeScript tests (forecast parity, money maths, Vault import) plus a CI check on every pull request (roadmap item 2c).
- G9 ~~Stale docs~~ ✅ resolved in the housekeeping PR (README rewritten, Lovable text removed, old plans archived).
- G10 Forecast UI needs a bilingual "not financial advice" disclaimer and data-date staleness badge.

---

## PHASE ML — Gold Regime & Volatility Forecasting (starting now)

### Why this route (verdict on the proposed plans)
- Exact price prediction fails on gold (random-walk-like, macro/geopolitical shocks) → forecast
  **probabilistic regimes + volatility bands** instead. ✅ keep.
- CatBoost for regimes ✅ good choice: strong on small, noisy tabular data (~2.8k daily rows),
  ordered boosting, tiny model, ONNX-exportable. Expect modest edge (honest target: beat
  climatology log-loss, not "high accuracy").
- Transformer/TFT for bands ❌ for v1: ~2.8k samples of one series is far too little; the draft
  model was leaking and predicting price levels. Volatility clusters, returns don't → GARCH/EWMA
  bands are the right, calibrated, explainable baseline. TFT stays as ML-4 challenger.

### Target definitions
- Horizon **H = 5 trading days (≈ 7 calendar days)** — matches "7-day" copy.
- Regime label from forward log return r = ln(P[t+H]/P[t]) and today's expected volatility σ (EWMA, `ml/paun_ml/vol.py`):
  0 Bearish Retracement (r < −0.75σ), 1 Sideways Consolidation (|r| ≤ 0.75σ), 2 Bullish Breakout (r > 0.75σ).
  (Replaced the original fixed ±1.5%, which made the class mix track volatility.) Today's threshold, e.g. ≈ 2.1%, is in the snapshot.
- Bands: P10/P50/P90 of H-day log return → applied to **live spot** in the app.

### Features (stationary)
- Gold technicals: RSI-14, Bollinger bandwidth & %B, distance to MA20/50/200, 1d/5d/20d log returns,
  20d realised vol.
- Macro: DXY 5d log return (`DX-Y.NYB`), **10Y real yield 5d change (FRED `DFII10`)**, 10Y nominal
  change (`^TNX`), WTI 5d return, USD/MYR 5d return, S&P 500 5d return, **GVZ level/change** (`^GVZ`).
- Central-bank purchase flows: quarterly (WGC) → parked; too coarse for 7-day horizon.
- All features use only data available at close t (ffill allowed, never bfill).

### ML-0 Housekeeping
- Add this file as `PLAN.md`; move old plan docs to `docs/archive/`.
- Create `ml/` (excluded from Vite/ESLint/Prettier): `requirements.txt` (pinned: catboost, pandas,
  numpy, yfinance, fredapi or plain requests, arch, scikit-learn, onnx, onnxruntime, shap),
  `ml/README.md`, `.gitignore` entries for `ml/data/`, `ml/artifacts/` scratch.
- `ml/colab.ipynb` thin notebook: clone repo → `pip install -r ml/requirements.txt` → run scripts →
  download artifacts. FRED key via Colab secrets.

### ML-1 Data & features (`ml/paun_ml/data.py`, `features.py`)
- Fetchers: Yahoo (GC=F, DX-Y.NYB, ^TNX, ^GVZ, CL=F, MYR=X, ^GSPC) with flat-column handling and
  stooq `xauusd` fallback for gold; FRED (`DFII10`) via key. Same code used for training **and** the
  daily snapshot job (no train/serve skew).
- `features.py` is the single source of truth; also exports `feature_spec.json` (ordered names,
  windows) and a **golden fixture** (`fixtures/features_golden.json`: raw input window + expected
  feature vector) for TS parity tests.

### ML-2 Model A — CatBoost (`ml/paun_ml/train_regime.py`)
- Walk-forward CV: `TimeSeriesSplit(n_splits=5, gap=H)` + final untouched test = last 12 months.
- Metrics per fold + test: multiclass log-loss, Brier, accuracy, macro-F1, reliability curve.
  Baselines: class prior (climatology) and "last week's regime". Must beat climatology log-loss.
- Optional probability calibration (temperature/isotonic on CV folds) if reliability is off.
- Export: `model.save_model("regime.onnx", format="onnx")`; verify with `onnxruntime` in Python
  that ONNX probs == CatBoost `predict_proba` (atol 1e-5); record input name/shape (`[N, n_features]`
  float32) and output names (expected `label`, `probabilities`) into `model_meta.json`.
- `model_meta.json`: version, train date range, feature order, class names, metrics, global
  SHAP importance (top drivers for UI copy).

### ML-3 Model B — Volatility bands (`ml/paun_ml/bands.py`)
- Fit GARCH(1,1) (Student-t) with `arch` on daily log returns; also EWMA (λ≈0.94) baseline.
- H-day variance = sum of GARCH multi-step forecasts (not naïve σ·√H); standardise realised H-day
  returns by forecast σ and take **empirical quantiles** q10/q50/q90 (captures fat tails/skew).
- Evaluate on test period: P10–P90 coverage (target 80% ±3), pinball loss vs constant-vol baseline.
- Export `bands_params.json`: {omega, alpha, beta, nu, lambda, q10, q50, q90, H}. Bands computed
  in TS — no ONNX needed for Model B.

### ML-4 (later) TFT challenger
- Real `pytorch-forecasting` TFT on returns, same walk-forward split. Promote only if it beats
  CatBoost+GARCH on log-loss / pinball loss + coverage **and** a simple regime-based allocation
  Sharpe out-of-sample. Otherwise stays a research notebook.

### ML-B Pretrained-forecaster benchmark (internal subproject — never ships to the app)
**Question:** is our CatBoost + EWMA/GARCH pipeline actually better than off-the-shelf pretrained time-series models? (The
"CatBoost beats foundation models" claim in the original notes came from the Gemini write-up and has not been verified by us.)
- **Candidates:** Amazon Chronos / Chronos-Bolt, Google TimesFM, Salesforce Moirai, and Kronos (finance-specific K-line model). Confirm the
  current model versions before building — this field moves fast. Run zero-shot first; fine-tuned variants only if zero-shot is competitive.
- **Method (rolling origin, same data as our models):** at every forecast date give the model the last ~512 daily gold closes and ask for the
  5-session-ahead quantiles. Score on the **same 5 walk-forward folds and held-out year**, with the **same metrics and the same rules**.
  - *Bands:* P10–P90 coverage and pinball loss vs our EWMA / GARCH bands and the constant-volatility baseline.
  - *Regimes:* convert each model's quantile forecast into the three regime probabilities (using the day's volatility-scaled threshold),
    then log-loss vs climatology and vs CatBoost, including the block-bootstrap interval (rule A4).
- **Caveats to state in the report:** (1) *contamination* — pretrained models may have seen gold prices up to their training cutoff, so older folds
  flatter them; the most recent year is the cleanest test. (2) A zero-shot model sees only price history while ours also uses macro inputs; report
  a price-history-only version of ours for a like-for-like row. (3) Many candidates on the same folds inflates the best score — read the intervals.
- **Compute:** small models run on CPU; the local RTX 5060 (8 GB, needs a CUDA build of PyTorch) or free Colab/Kaggle GPUs for larger ones.
  ~3,500 forecast dates in total.
- **Where / output:** `ml/benchmarks/` (own `requirements-bench.txt`, so PyTorch never enters the main workspace) → `ml/reports/benchmarks.md`
  with a candidate table + chart following the existing evaluate.py style. Decision rule: only consider adopting a pretrained model if it beats our
  baseline on the held-out year **and** passes A4; otherwise we keep the current pipeline and record the evidence.
- **When:** last on the roadmap (order 6, after the backend phase) — see "Reordered 2026-10-07". Also the natural entry point for the ML-4 TFT challenger.

### ML-5 Daily market snapshot (CORS & keys strategy)
- GitHub Action `.github/workflows/market-snapshot.yml`, cron daily ~22:30 UTC (after US close),
  Python 3.12, runs `ml/paun_ml/snapshot.py`, publishes to the **`data` branch** (force-free,
  append commits; or `gh-pages`). FRED key = GitHub secret.
- `market-snapshot.json` (~50–100 KB): asOf date, last ~300 daily closes of required series
  (enough for MA-200), Python-computed feature vector for asOf, official regime probs + top SHAP
  drivers for that day, GARCH σ state, daily XAU/USD + USD/MYR/SGD/AED/INR closes.
- App fetches `https://raw.githubusercontent.com/PravinRaj01/paun/data/market-snapshot.json`
  (CORS `*`, no key) with fallback to a bundled copy in `public/` if offline/unreachable.
- Fallback option if needed later: TanStack Start server route as same-origin cached proxy.
- Bonus reuse: real history fixes G3, keyless daily spot/FX fixes G5, and powers DCA (3C).

### ML-6 App integration (TypeScript)
**Revised 2026-10-06 (after rule A4 blocked Model A):**
- **Parity fixture = the Python snapshot itself.** `market-snapshot.json` already carries the raw history (600 sessions), the Python-computed
  features and the Python bands for the same day; the Vitest parity test recomputes them in TypeScript and compares. No separate golden file to rot.
- **The ONNX hook is deferred.** While `forecast.regime_shipped` is false there is nothing to run in the browser, so `onnxruntime-web` is not added
  yet (saves several MB). It is built only when a Model A passes A4; the snapshot carries `regime_probs` meanwhile for cross-checking.
- **First UI slice is bands-only:** a Forecast card on the Markets page (likely-range bar, median, as-of + staleness, disclaimer, EN/BM), then the
  real-history `SpotChart` (G3/G4).
- The snapshot embeds `bandsParams` and `recommended_band`, so one JSON is self-contained (no params/snapshot version skew). It is fetched from
  the `data` branch with a bundled `public/data/market-snapshot.json` fallback.

Original sketch (kept for the later regime/ONNX step):
- `src/lib/forecast/features.ts` — TS port of `features.py`; Vitest parity test against the golden fixture.
- `src/lib/forecast/bands.ts` — GARCH recursion + H-day variance + quantile factors →
  `{p10,p50,p90}` in USD/oz applied to live spot; EWMA fallback.
- `src/lib/forecast/useGoldForecast.ts` — client-only: dynamic `import("onnxruntime-web")` inside
  effect (never during SSR), `executionProviders: ["wasm"]`, wasm files from jsDelivr pinned version
  (or self-host in `public/ort/`), loads `/models/regime.onnx` + `model_meta.json`, builds the
  float32 tensor in `feature_spec` order, returns {probs, bands, drivers, asOf, stale, status}.
  Supports what-if overrides (e.g. DXY +1%, live spot) by recomputing features.
- UI: Forecast card on Markets page (or `/forecast` route): regime probability bar, cone on the
  real-history `SpotChart`, top drivers, asOf + staleness badge, disclaimer. Values converted via
  `baseRateOf`, per gram via `GRAMS_PER_OUNCE`/purity. All copy in `en.json`/`ms.json`.
- Add Vitest (G8). Replace `spotSeries` with snapshot history (G3); i18n `SpotChart` (G4).

### Model refresh
- Retrain monthly (Colab), commit new `public/models/regime.onnx` + meta to `main` (low frequency,
  OK). Snapshot job runs daily on `data` branch.

---

## Remaining features (from upgrade plan — details preserved)

### 3C. DCA Backtester & Planner (roadmap item 3 — spec approved 2026-10-07; pure client-side)
"What if I bought 1g (or 1 paun = 8g, 1 mayam ≈ 3.37g) of 916 every month for the last 1/3/5 years
vs keeping cash in savings / Fixed Deposit?" Outputs: cumulative grams, average acquisition cost
per gram, net profit at current spot vs savings comparison. Uses snapshot daily history (XAU/USD +
USD/MYR) → real backtest instead of synthetic.

**Spec (owner-approved 2026-10-07).**
- **Where:** a new page `/dca` with its own icon in the side dock (not a section of Markets, which is already long on phones).
- **Inputs:** monthly contribution as **grams** (default 1 g, the original example) or as an **amount in the base currency**; period **1 / 3 / 5 years**
  (capped by the snapshot's history); purity (default 916); country (its shop mark-up, duty and tax apply when the price basis is "shop price");
  **savings rate % a year, editable, default 3%** (an indicative starting guess, said so on screen), compounded monthly.
- **Buy rule:** one purchase on the **first trading day of each month** in the window, at that day's XAU/USD close.
  Price per gram = spot per gram x fineness, then the same shop mark-up / duty / tax factors `analyze()` uses for a purchase (making fee and melting are **not** part
  of v1; melting never applies when buying). The savings comparison deposits **the same cash** on the same dates.
- **Currency:** all maths in USD. Cash amounts are converted with the **historical USD/MYR** from the snapshot when the base currency is MYR; for any other
  base currency (the snapshot has no history for it) today's rate is used and the screen says so. USD base needs no conversion. The ringgit figures use the
  market USD/MYR (the latest value is shown on the page), which can differ from the watchlist rate used elsewhere in the app; the page says so.
  The dock's phone icons shrank from 40 to 36 px so that eight icons still fit a 360 px screen.
- **Valuation today:** (a) at spot, (b) the estimated sell-back after the susut deduction (`sellQuote`) when the price basis is "shop price".
- **Outputs:** grams accumulated, total cash put in, average cost per gram, value today (both ways), profit/loss, savings balance, "gold beat savings by X" or
  "savings beat gold by X"; a chart of cash in vs gold value vs savings balance over time; a collapsible table of the purchases.
- **Honesty:** a backtest is not a forecast. The window includes a large gold rally, so show the disclaimer and the data range
  ("prices from <first date> to <asOf>"). The data starts 2021-08-06, so the longest honest window is about 5 years.
- **Build:** pure engine `src/lib/dca.ts` (`backtestDca`) with hand-computed tests first; then `src/components/gold/DcaBacktester.tsx` and `src/routes/dca.tsx`
  (the route tree regenerates), a dock entry in `SideDock.tsx`, EN/BM copy in `src/locales/`. Reuse `useSnapshot` (`longHistory`), `analyze` / `sellQuote` /
  `baseRateOf` / `fmt` / `premiumOf` from `src/lib/gold.ts`.
- **Edge cases to test:** a month with no trading day in the data, a window longer than the history (clamp and say so), 0% and negative savings rate,
  a zero or negative contribution (rejected), missing snapshot (offline copy still works).

### 3D. Receipt & Hallmark AI Scanner (Vision/OCR)
Photo of receipt (Habib, Tomei, Poh Kong, kedai emas), bullion certificate, or hallmark (916,
999.9, 750, 22K…) → extracts purity, weight (g), upah tukang, purchase date, total paid →
auto-creates a Vault entry. Camera capture → `paun-api` Worker `POST /scan` → **Gemini** vision with a
structured-output schema (purity, weight_g, upah, date, total, currency, confidence); **Groq** vision model
as fallback. The image is never stored; extracted fields are shown for the user to confirm before the Vault
entry is saved. Use Gemini's paid tier (free-tier inputs may be used for training) and say so in the scanner
UI. No DB needed. Reuse `normPurity()` legacy mapping.

### 2. Price Alert & Push Notification System
Threshold alerts ("Gold 916 fell below RM 390/g"), arbitrage spread triggers ("Dubai–Malaysia
spread > 7.5% net"), weekly wrap (high/low + portfolio summary). Cloudflare Worker cron every
5–15 min → Neon Postgres via `@neondatabase/serverless` over HTTP; table
`alert_subscriptions` (user id, target, above/below, currency, channel). Channels: Web Push
(`PushManager`; Android, iOS 16.4+ installed PWA, desktop — primary; note: push requires a service
worker → revisit constraint 4 deliberately), Telegram bot (secondary), Resend email (digests).
First real backend: the `paun-api` Worker (see "Backend" below).

### 3E. Street Rate & Counter Board Crowdsourcing
Users log counter rates (Poh Kong, Habib, Tomei, Wah Chan; Lebuh Ampang, Masjid India, Mustafa
Singapore, Deira Gold Souk). True retail spread vs spot; "Best Street Rate Near You" leaderboard
with crowd-verified timestamps; moderation/anti-spam (Groq text model screens submissions). Same `paun-api` Worker + Neon as feature 2.
Retail spread anomaly detection (from ML plan) builds on this data.

### Backend: `paun-api` Cloudflare Worker (first used by 3D, then 2 and 3E)
One Worker in `workers/paun-api/`, deployed with Wrangler independently of where the frontend is hosted.
- `POST /scan` → Gemini vision (Groq fallback) for 3D.
- Cron Trigger every 5–15 min → read spot (daily snapshot or live feed) → Neon over HTTP → Web Push /
  Telegram / Resend (feature 2).
- `POST/GET /street-rates` → Neon (feature 3E); Groq screens spam/abuse.
- Abuse control without login: Cloudflare Turnstile + Workers rate-limiting binding; CORS allow-list limited
  to Paun's origins. Anonymous identity = random device id generated client-side (LocalStorage).
- Optional low-priority AI extra: Groq writes the plain-language EN/BM explanation of the daily forecast and
  weekly wrap server-side in the snapshot/cron jobs (once per day, not per user request).

### Platform & deployment (added 2026-10-06 — the project is now fully decoupled from Lovable)
**Decision: Cloudflare Workers with static assets** (the build already targets Nitro preset `cloudflare-module`; `wrangler deploy`). Same platform as the planned
`paun-api` Worker (cron, KV, secrets), so one login/pipeline and no cross-vendor CORS. Vercel was considered: better DX, but a second vendor, metered usage,
and (as far as known) non-commercial-only free terms. "Cloudflare Pages" is the older product — new work targets Workers. Re-verify current pricing/limits at deploy time.
Steps (all small; do before the backend phase):
1. ✅ **Done 2026-10-06 — explicit Vite config** replacing `@lovable.dev/vite-tanstack-config` (TanStack Start, React, Tailwind, tsconfig paths, Nitro `cloudflare-module`, dev port); drop the package
   and its `bunfig.toml` exclusions. Verified: typecheck/lint clean, tests pass, production build **byte-identical** to the old one (same 98 files, same sizes, same
   `wrangler.json`), dev server screenshot unchanged. Dropped on purpose: Lovable's sandbox mode, error-logger plugins, asset proxy, dev-build `keepNames`
   (no longer valid in Vite 8). `lightningcss` is now declared explicitly.
2. ✅ **Done 2026-10-06 — committed `wrangler.jsonc`** (Worker name `paun-web`, `compatibility_date` pinned to the tested date instead of the build day, `nodejs_compat`,
   Workers Logs on, custom-domain placeholder). Nitro merges it into `.output/server/wrangler.json`; `wrangler` is a dev dependency; scripts `preview:worker` and `deploy`;
   guide in `docs/deploy.md`.
3. ✅ **Deployed 2026-10-06 to https://paun-web.paun-gold.workers.dev** (account workers.dev subdomain `paun-gold`; first request failed with a TLS handshake error for ~1 min while Cloudflare
   issued the new subdomain's certificate — normal, do not redeploy). Live checks: all routes 200 with the same byte sizes as local; 60 repeated server-rendered requests, all 200,
   **no CPU-limit error pages**, median 23 ms / p95 90 ms; hashed JS/CSS cached 1 year immutable, snapshot/manifest revalidate; live page screenshot identical to local.
   Still to confirm: the dashboard's *CPU time* metric (the authoritative number; no errors is strong evidence, not proof). Earlier local half: the built app runs in the real Workers runtime (`wrangler dev`): all routes 200, snapshot + manifest served, no log errors, page identical;
   `wrangler deploy --dry-run` passes (66 modules, ~4.2 MB / 0.9 MB gzipped, 30 static files). **Remaining — needs the owner's Cloudflare login:** a real preview deploy to check: SSR CPU time within the free plan's per-request budget (else the ~$5 plan, or make Markets client-only); `/data/market-snapshot.json`
   cached sensibly; raw.githubusercontent snapshot fetch works from the deployed origin.
4. **Cloudflare Git integration** on `main` (build `bun run build`; test that Cloudflare's build env handles Bun, else npm).
5. 🟡 **Pushed on branch `feat/forecast-platform` (PR pending merge).** The Action only becomes runnable once it is on `main`. Hardened first: Yahoo/FRED retries with
   back-off (cloud runners are often rate-limited) and a freshness guard that fails the job rather than publish data older than 6 days. **To do after merging:** GitHub -> Actions ->
   `market-snapshot` -> Run workflow; confirm the `data` branch and its raw URL exist; reload the site and check the "Offline copy" badge is gone. Known risk: Yahoo may block
   GitHub's IPs; if so, the job fails visibly and the app keeps its bundled snapshot - then switch the price source for the job.
6. ✅ **Lovable leftovers cleanup (housekeeping PR, 2026-10-07):** removed `lovable-error-reporting.ts` and its use in `__root.tsx`, archived `.lovable/` plans to
   `docs/archive/lovable-plans/`, dropped the `.gitignore` entry, rewrote the README, replaced the AGENTS.md preface, fixed comments. Remaining mentions are history or the
   "never use Lovable AI Gateway/Cloud" rule.
The `data` branch stays for the daily bot commits (keeps `main` history clean) — no longer because of Lovable.

### Sequencing
| Order | Item | Status |
|---|---|---|
| 0–2 | ML scaffold, training + evaluation, snapshot Action, app integration (ML-0 … ML-6 first slice) | ✅ done |
| 2a | Platform: leave Lovable + Cloudflare deploy + daily snapshot Action (see "Platform & deployment") | ✅ first Cloudflare auto-deploy confirmed (22:42 UTC, after the push to `main`); Lovable cleanup done in the housekeeping PR. 🟡 still to confirm: the first *scheduled* snapshot run |
| **2c** *(new)* | **Safety net:** PR checks (tests + typecheck on every PR), tests for the app's money math (closes G8), Vault import fix (moved here from "Pending") | ✅ built on branch `chore/housekeeping` (PR pending review): CI workflow, 25 money-math tests, strict Vault import (checked end-to-end in a real browser: merge keeps existing items; broken file, non-list and duplicates all report correctly) |
| 3 | 3C DCA Backtester (real 5-year history is already in the snapshot) | 🟡 built, awaiting commit and merge: engine `src/lib/dca.ts` with 23 hand-checked tests, page `/dca` (EN/BM) with a dock icon, checked in a real browser at desktop, 390 px and 360 px |
| 4 | 3D Receipt/Hallmark Scanner — first use of `paun-api` (needs the owner's Gemini/Groq key) | |
| 5 | 2 Notifications + 3E Street rates on `paun-api` + Neon (needs the owner's Neon account) | |
| **6** *(moved from 2b)* | ML-B pretrained-forecaster benchmark — research only, never ships | |
| later | ML-4 TFT challenger; parked ideas | |

**Reordered 2026-10-07 (owner-approved).** ML-B moved to last because it cannot change what ships while rule A4 blocks Model A, and it is
compute-heavy: its value is deciding whether Model A or the bands deserve more work, which is not urgent. 2c was added because nothing runs
automatically on pull requests today, the app's money math has no tests, and the Vault import can silently replace a user's whole vault
(a data-loss risk).

**2c acceptance (Vault import):** strict schema (array of `{id?, name, weight>0, purity ∈ PURITIES, paidUsd>=0, date YYYY-MM-DD}`); legacy
purity codes (`"22K"` → `"916"`); an *unknown* purity is skipped, never silently turned into 916; **merge, never replace**; duplicate ids
skipped; toasts "Invalid JSON file", "Expected a list of items", "Imported 4 items (1 skipped: invalid purity)".

### Pending (carried over)
- ~~Vault import validation~~ → moved to roadmap item **2c** (acceptance criteria copied there).
- GoldMap geolocation permission flow + real-phone map behaviour: real-device verification.
- i18next auto-translation CLI not set up (manual en/ms with locked glossary).
- G7 resetAll scope. G9 README/doc cleanup is part of the housekeeping PR (2a step 6).

### Parked ideas
- Ar-Rahnu calculator: Marhun value, margin 65–80%, upah simpan ≈ RM0.60–0.85 per RM100/month,
  6/12/18-month redemption totals, auction-risk warnings.
- Zakat Emas: Emas Simpanan 85 g nisab, 2.5%; Emas Perhiasan uruf by state (Selangor 800 g,
  Johor 850 g, Federal Territories 150 g).
- Upah & Resale Breakeven Analyzer: spot appreciation needed to break even after upah and buyback
  melting discounts (10–25%).
- Kronos (financial foundation model) for scenario stress tests; TCN for client-side features.

---

## Critical files
- New: `PLAN.md`, `ml/**`, `.github/workflows/market-snapshot.yml`, `public/models/regime.onnx`,
  `public/models/model_meta.json`, `public/models/bands_params.json`, `src/lib/forecast/*`.
- Modified: `src/lib/gold.ts` (drop `spotSeries`), `src/components/gold/SpotChart.tsx`,
  `src/routes/markets.tsx`, `src/locales/{en,ms}.json`, `package.json` (onnxruntime-web, vitest),
  `.gitignore`, `.prettierignore`, `eslint.config.js` (ignore `ml/`), `AGENTS.md` (new rules).
- Reuse: `baseRateOf`, `fmt`, `GRAMS_PER_OUNCE`, `fineOf`, `normPurity` (`src/lib/gold.ts`),
  `useI18n` (`src/lib/i18n.ts`), `useGold` (`src/lib/gold-store.tsx`).

## Verification
- Python: `pytest ml/tests` (feature no-lookahead test: features at t unchanged when future rows
  are appended; label alignment; ONNX vs CatBoost probability equality).
- Colab run prints per-fold + test metrics vs baselines; band coverage report.
- TS: `bunx vitest run` — feature parity vs golden fixture, band engine vs Python reference
  values, existing `gold.ts` math.
- App: `bun run dev` → Markets page: forecast card loads only client-side (no SSR error), ONNX
  probs equal snapshot's official probs for asOf, cone on real history, EN/BM toggle, base currency
  switch, offline fallback to bundled snapshot. `bun run build` passes.
- Action: manual `workflow_dispatch` run publishes snapshot to `data` branch; raw URL fetch from
  browser succeeds (CORS).
