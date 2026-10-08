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

1. No login/database — state client-side (`src/lib/gold-store.tsx`). *(Amended 2026-10-08: an OPTIONAL sign-in with Vault sync is planned as item 4b; nothing may ever require it, and everything keeps working without it.)* ML (1) and DCA (3C) stay
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
    (`wrangler secret put`). The client calls our own Worker, never a vendor API directly. **Exception (owner-approved 2026-10-08, phase 4.6c):** a Gemini key the user supplies for their own scans: kept only in their browser (their choice of this device or this session), sent per request through our Worker, never stored or logged by Paun.
11. **Every date or time shown in the app states its timezone** (owner requirement 2026-10-07). Market dates (snapshot `asOf`, chart, DCA) are **New York trading days** of the
    gold futures exchange and are labelled as such; a date like `2026-10-06` must never shift to the previous day for viewers west of UTC. Moments (when a price was set or
    fetched) show in the viewer's own local time with the zone name, e.g. "7 Oct 2026, 11:34 GMT+8". Dates the user types (Vault "Bought on") are "your local date". All of it is
    formatted through `src/lib/datetime.ts`, never with `toLocale*` calls in components (a test enforces this).

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

### 3B. Live price: shared feed for the landing page, own key inside the app, and price honesty (owner decision 2026-10-07)
**Constraint:** the owner's GoldAPI plan allows only **100 requests a month**, so one shared key cannot give every visitor a live price (every 30 min on weekdays would need ~1,100).
**Decision:** a shared near-live feed for the **landing page only**; inside the app the default is the latest daily close, and a one-time pop-up invites the user to add their **own** GoldAPI
key for a live price or continue with the close. Never a hard gate.
- **Shared feed (landing page only):** Worker `workers/paun-api/` (`https://paun-api.<subdomain>.workers.dev`), cron on weekdays every ~15 min: fetch the latest gold futures price from Yahoo
  (same instrument as the chart, no key; unofficial, so it is **tested from Cloudflare before we rely on it**), store `{ priceUsdOz, fetchedAt, provider }` in KV. **Backup:** the owner's `GOLDAPI_KEY`
  (Worker **secret**, `wrangler secret put`, never in the repo, browser or chat) is used only when Yahoo fails, under a hard monthly budget (counter in KV; about 3 calls per weekday, capped at
  90 a month; `MONTHLY_BUDGET` variable). `GET /spot` reads KV only, never the provider, so visitors cannot burn any quota: `{ priceUsdOz, fetchedAt, ageSeconds, stale, provider }`, short edge
  cache, CORS allow-list. `GET /health`. If the feed is unavailable the landing page falls back to the latest close and says so. Note GoldAPI is *spot* and the chart is *futures*: the label names the provider.
- **Inside the app (Markets, Calculator, Arbitrage, Vault, Monthly plan):** default price = latest close (as today). **First visit to an app page** (not the landing page) when the user has no own
  key and has not chosen yet: a dialog "Want a live price?" with **[Add my GoldAPI key]** (free at goldapi.io, 100 free requests a month, the key stays in the browser; opens the key field) and
  **[Continue with the latest close]**. Closing the dialog counts as "continue". The choice is remembered (`settings.livePromptSeen`) so it never nags; Settings always offers the key later.
- **Forecast range:** anchored to the live price only when the user's own key supplied it (`source: "live"`); otherwise to the close. The card says which (`buildForecast(snapshot, livePrice)` already supports it).
- **Price honesty (client only, no Cloudflare needed):** delete the invented trend (`spotSeries`) from the Markets chart: placeholder while loading, then real closes, or "history unavailable". An untouched default
  ($2,650 placeholder) is labelled as a placeholder if no source could be reached. Plain-language copy: Settings explains the default (latest daily close) and the key option; the header label gets a short
  explanation; the Vault subtitle no longer says "valued live".
- **Tests:** client: `shouldPromptForLiveKey(settings)` (shown once, never for own-key or manual-price users, never on the landing page), chart never uses invented data. Worker: scheduled handler (Yahoo ok, Yahoo fails
  then GoldAPI, budget exhausted, no key), `/spot` shape and stale flag, CORS, KV-only reads (mocked `fetch` and a fake KV).
- **Phases** (each is one branch and one PR; after each merge: pull `main`, delete the branch, confirm Cloudflare's build):

  | Phase | What | Owner does | Done when |
  |---|---|---|---|
  | 3b.1 | Price honesty + one-time key pop-up (client only) | — | ✅ merged 2026-10-07 (PR #5) |
  | 3b.2 | **Every date and time names its timezone** (client only; standing constraint 11) | — | ✅ built on `feat/dates-with-timezone`: shared formatter `src/lib/datetime.ts` (12 tests, including a guard that fails if a component formats a date itself); Markets chart and footnote, forecast card, DCA, Vault and the price-label tip name their zone; checked in a real browser set to Los Angeles (EN) and Kuala Lumpur (BM): dates do not shift, the Vault date defaults to the viewer's local day |
  | 3b.3 | `workers/paun-api` skeleton: `GET /health`, CORS allow-list, own `wrangler.jsonc`, Vitest tests, a CI job | approves the first deploy; adds the second Worker to Cloudflare Git builds (root directory `workers/paun-api`) | ✅ done 2026-10-07 (PR #7 and #8): `/health` verified live; CORS allow-list incl. branch previews; manual deploys work |
  | 3b.4 | **Yahoo-from-Cloudflare test:** a temporary `GET /probe` in the deployed skeleton fetches GC=F once and reports status, price and latency; removed afterwards | approves the deploy | ✅ done 2026-10-07: from Cloudflare's Kuala Lumpur data centre Yahoo answered in 52 ms with a real GC=F price (struck 10 min earlier). **Decision: Yahoo is the primary source, GoldAPI the budgeted backup.** Only one data centre was tested; the first scheduled runs will show whether others are blocked (watch the logs). The temporary `/probe` is removed in 3b.5 |
  | 3b.5 | `/spot` + weekday cron (~15 min) + KV + budgeted GoldAPI backup (`MONTHLY_BUDGET` 90) | creates the KV namespace; runs `wrangler secret put GOLDAPI_KEY`; confirms GoldAPI's terms allow public display | ✅ code built on `feat/spot-feed` (158 tests in all): `/spot` reads KV only; cron `*/15 * * * 1-5`; Yahoo first; GoldAPI only if Yahoo fails and the stored price is over 30 min old, capped at 3 a day and 90 a month (reserved before the call, so a failed call still counts); key never logged; verified locally in the Workers runtime against real Yahoo. ✅ done 2026-10-07/08 (PR #9): deployed, KV namespace created, `GOLDAPI_KEY` set by the owner, and the scheduled runs verified (price refreshed at :30 and :45, about 50 s after the slot; provider yahoo). The owner confirmed GoldAPI's terms allow showing its price publicly (from GoldAPI's documentation; I could not read their site myself) |
  | 3b.6 | Landing page reads `/spot`: "live · 12 min ago (11:34 GMT+8) · Yahoo", falling back to the latest close with a note | — | ✅ done 2026-10-08 (PR #10), verified on the deployed site: "Live · 12 minutes ago · 8 Oct 2026, 00:35 GMT+8 · Gold futures (GC=F) via Yahoo Finance". `src/lib/spot-feed.ts` + the landing page; the shared price replaces only the automatic daily close, never a price the user set or their own key's; falls back to "Latest daily close, … (New York trading day)" if the feed is unreachable (BM too). Known leftover: the map and example card can flash the $2,650 placeholder for a moment before any price loads |

  The scanner (item 4) reuses the Worker from 3b.3, so its own build-order step (1) is already covered by then.
- **Needs from the owner:** approval before any Cloudflare resource is created (KV namespace) or deployed; running `wrangler secret put GOLDAPI_KEY` themselves; confirming the GoldAPI terms allow showing
  the backup price publicly (their site could not be read automatically; with Yahoo as primary this matters only when the backup is used).

### 3D. Receipt & Hallmark AI Scanner (Vision/OCR)
Photo of receipt (Habib, Tomei, Poh Kong, kedai emas), bullion certificate, or hallmark (916,
999.9, 750, 22K…) → extracts purity, weight (g), upah tukang, purchase date, total paid →
auto-creates a Vault entry. Camera capture → `paun-api` Worker `POST /scan` → **Gemini** vision with a
structured-output schema (purity, weight_g, upah, date, total, currency, confidence); **Groq** vision model
as fallback. The image is never stored; extracted fields are shown for the user to confirm before the Vault
entry is saved. Use Gemini's paid tier (free-tier inputs may be used for training) and say so in the scanner
UI. No DB needed. Reuse `normPurity()` legacy mapping.

**Spec (owner-approved 2026-10-07): Gemini first, Groq later as the fallback; Turnstile + rate limit + daily cap.**
- **Where it lives:** a new Worker in `workers/paun-api/` (own `wrangler.jsonc`, own tests, deployed on its own; the front end is `paun-web`). First endpoints:
  `GET /health` and `POST /scan`.
- **`POST /scan`:** the browser resizes the photo (longest side ~1280 px, JPEG ~0.8) and sends it with a Turnstile token. The Worker (1) checks the origin against an
  allow-list (the Worker domain and localhost), (2) verifies the Turnstile token, (3) applies the per-visitor rate limit and the **global daily cap** (a counter; when it is hit the
  Worker answers "scanner busy, try tomorrow" **without calling the AI**), (4) calls Gemini with the image and a **structured-output schema**, (5) validates the answer with zod and
  returns only fields it trusts. The image is never stored or logged; logs hold status codes and timings only.
- **Extracted fields (each nullable, never guessed):** item name, purity (must be one of the app's stamps or a legacy karat label, else null), weight in grams, workmanship fee
  (*upah*, per gram or total), purchase date (real calendar date, not in the future), total paid and its currency. The prompt tells the model to answer null rather than guess.
- **Secrets and config:** `GEMINI_API_KEY` and `TURNSTILE_SECRET` are Worker secrets (`wrangler secret put`), never in the browser or the repo. The Turnstile *site* key is public.
  The model name, daily cap and per-visitor limit are plain variables so they can change without code. Verify the current Gemini model name and free/paid terms when implementing.
- **Front end:** a "Scan receipt" button on the Vault page opens a dialog: camera or photo picker (`<input type=file accept=image/* capture>`), preview, Turnstile, upload, then an
  **editable pre-filled form**; nothing is saved until the user confirms. A pure `scanToVaultItem` mapper converts the result (paid amount converted with the watchlist rate for the
  detected currency, or left blank for the user if the currency is unknown). Copy in EN/BM. Privacy line in the dialog: the photo is sent to Google's Gemini to be read and is not stored by Paun.
- **Privacy / terms (owner decision at deploy time):** Gemini's free tier may use submitted content to improve Google's products; the paid tier does not. Choose before real users scan receipts.
- **Evaluation (honest accuracy):** `workers/paun-api/eval/` runs the scanner over 3-5+ real sample photos (kept out of git) against hand-written expected JSON and prints per-field
  accuracy. A scanner that is wrong half the time on weight or purity is not shipped as "zero manual entry".
- **Tests:** validation and sanitising of the model's answer, rate limit and daily cap logic, CORS allow-list, Turnstile failure paths and Gemini errors (all with mocked `fetch`);
  the pure `scanToVaultItem` mapper.
- **Build order (phases):**
  | Phase | What | Status |
  |---|---|---|
  | 4.1 | Worker skeleton with `/health`, deployed | ✅ done (3b.3) |
  | 4.2 | `POST /scan` against a mocked Gemini: origin allow-list, Turnstile check, per-visitor and daily caps, Gemini call, sanitising of every field | ✅ built on `feat/scan-endpoint` (253 tests in all; run locally against the real Turnstile check and a real Gemini request with fake keys: reaches Google, answers 400 for the fake key as expected). **Not yet verified with a real Gemini key**: the exact structured-output field (`responseJsonSchema`) and model name are taken from Google's current docs and are confirmed only by the first real call (phase 4.4). Until both secrets are set the endpoint answers `503 scanner_not_configured`, so deploying first is safe |
  | 4.3 | Front-end: "Scan receipt" on the Vault page, resize + Turnstile widget (site key `0x4AAAAAAFQh142918CMU2zm`, public), editable pre-filled form, `scanToVaultItem`, EN/BM, privacy line | ✅ built on `feat/scan-frontend` (275 tests in all): `src/lib/scan.ts` (request, validation, `scanToVaultForm`, error messages), `src/lib/scan-image.ts` (1280 px JPEG in the browser), `Turnstile.tsx`, `ScanReceiptDialog.tsx`, wired into `/vault`. It fills the page's existing add form (editable); nothing is saved until the user presses Add. A receipt in another currency is converted with the watchlist's rate, never a guessed one (unknown currency: price left blank and said so). Checked in a real browser against the real Worker and real Gemini with Cloudflare's test Turnstile keys: a phone photo, an invoice (Malay UI) and a non-receipt all behave. **Not yet tried on the live site with the real Turnstile widget** (needs the merge and deploy first) |
  | 4.4 | Real-photo evaluation (`workers/paun-api/eval/run.ts`, `bun run eval:scan`), per-field accuracy; decides whether it ships as "scan" or "scan, then check" | ✅ run 2026-10-08 on 5 internet sample receipts (Public Gold and two shop receipts, one handwritten, two phone photos) with the real Gemini call: **25 of 25 scored fields correct** after one prompt fix (first run: 24 of 25; a bar-premium column was read as a making fee of 0, now "premium, transport, tax and handling are not a making fee"). The model name and the structured-output field are confirmed working. Caveats: only 5 photos, the prompt was tuned on them, and 3 are clean images; a multi-item invoice is read as its first item and flagged confidence medium (the form is always editable). Re-run with your own phone photos before trusting it more |
  | 4.5 | Groq fallback only if needed | |
  | 4.6 | **Before sharing the scanner with other people** (owner decisions 2026-10-08): Beta tag, an honest free-tier privacy line, and an optional own Gemini key kept in the browser. Details below | ✅ built on `feat/scan-polish` (304 tests in all): Beta tag on the Vault button and the dialog title; the privacy line switches by key (free-tier wording with Paun's key, "under your Google account's terms" with your own); a Gemini key block in Settings with "remember on this device" or "this session only", cleared by Reset all; the Worker takes the key in `x-gemini-key`, skips only the shared daily cap, and maps Google's 400/401/403 to `user_key_rejected` and 429 to `user_key_quota`. Checked in a real browser with the real Worker: a session-only key lands in sessionStorage only, switching moves it to LocalStorage only, Reset all clears both, and a deliberately wrong key shows "Google did not accept your Gemini key". Malay checked. **Still to do by the owner:** a real scan on the live site with the real Turnstile widget, and the 10-own-photos trial before the Beta tag can go |

  | 4.7 | **Multi-piece receipts, one scan at a time, themed notifications** (owner request 2026-10-08) | ✅ built on `feat/scan-multi` (351 tests in all). **Worker:** the answer is now a list of pieces (up to 20) plus the receipt's own date, grand total and currency; each piece is checked on its own and a piece that tells us nothing is dropped; the older one-piece `fields` view is still returned so a page deployed first keeps working. **Page:** a scan opens a **review panel** above the add form instead of filling it: one editable card per piece (name, weight, purity, price in the base currency, date), a **(-)** on each to remove it, **Add another piece** for one the scanner missed, the receipt total beside the sum of the typed prices (with a warning when they clearly differ), and one button to add all of them; nothing is saved before that. An unread purity must be chosen (never silently 916). **One at a time:** while a review is pending the Scan button is disabled and says why; the pending review survives a refresh (sessionStorage, fields only, never the photo) and is cleared by Add or Discard. One-piece receipts use the same panel and take the receipt's grand total as the price; multi-piece receipts use each line's own amount and never split the total by guesswork. **Notifications** now use the app's own surface, border, font and radius, with a green, gold or red tint by kind, in dark and light. Real Gemini evaluation: 30 of 30 scored fields correct, and `rec5` now returns its 3 bars (the eval also scores the piece count). Checked in a real browser on `rec5` (3 rows, remove one, add one by hand, add 3 to the vault, scanning unlocked again), `rec2`, Discard, a refresh, both themes and a 360 px phone in Malay. Known weak spot: handwritten amounts are sometimes misread (one run read 31,060 and 4,072 on `rec5`); the totals warning exists for exactly that. |

  **4.6 details (owner decisions 2026-10-08)**
  - **No money:** Paun's own Gemini key stays on the **free tier**. On the free tier Google may use submitted content to improve its products, so the dialog says so plainly (b). The own-key option (c) is the way out for anyone who minds. If the owner ever turns on billing, only the privacy sentence changes.
  - **(a) Beta tag:** a small "Beta" badge on the Scan receipt button and in the dialog title, with the tooltip "New, can make mistakes. Check every field." (EN/BM). It stays until the scanner has been tried on at least 10 of the owner's own phone photos (the 25-of-25 result was 5 clean internet samples).
  - **(b) Privacy line, chosen by which key reads the photo:**
    - With **Paun's key**: "Your photo is sent to Google's Gemini to be read; Paun does not store it. Paun uses Google's free tier, where Google may use submitted content to improve its products. To use your own terms, add your own Gemini key in Settings."
    - With **the user's own key**: "Your photo is sent to Google's Gemini using your own key, under your Google account's terms."
  - **(c) Own Gemini key, browser only, never stored by Paun.**
    - **Where it lives:** a block in Settings. The user chooses **"remember on this device"** (LocalStorage) or **"this session only"** (sessionStorage: gone when the browser closes). Same for signed-in and anonymous users. It is **never** part of `Settings`, so it can never end up in an export; `resetAll` clears it.
    - **How it is used:** sent with each scan to the `paun-api` Worker in the `x-gemini-key` header; the Worker uses it instead of Paun's key and never stores, logs or returns it. The browser still never calls Google itself. The Settings text says the key passes through Paun's server only to reach Google.
    - **Limits with an own key:** Paun's **daily cap is skipped** (it costs Paun nothing); Turnstile and the per-visitor hourly limit stay as abuse control. A rejected key or a quota hit gets its own message.
    - **Standing constraint 10 is amended** (done in this commit) to allow exactly this.
    - **Build:** `src/lib/gemini-key.ts`; a block in `SettingsDialog`; `ScanReceiptDialog` shows the Beta tag and the right privacy line and sends the header; `src/lib/scan.ts` gets `user_key_rejected` and `user_key_quota` messages; Worker: CORS allows `x-gemini-key`, the handler validates its shape, prefers it, skips only the daily cap, maps Google 400/401/403 to `422 user_key_rejected` and 429 to `429 user_key_quota`. Tests: key present and absent, daily cap skipped but hourly limit kept, rejected and quota paths, the key never in a log or a response, `gemini-key.ts` modes (device, session, switching clears the other, storage throwing). Real-browser check with a deliberately wrong key and a session-only key.

  **Request shape (built):** `POST /scan` with JSON `{ image: <base64 JPEG/PNG/WebP, resized by the browser>, mimeType, turnstileToken }`; answers `{ ok: true, readable, confidence: "high"|"medium"|"low", fields: { itemName, purity, weightGrams, makingFee: {amount, per: "gram"|"total"}, purchaseDate, totalPaid, currency } }`, each field `null` when not clearly readable or when it fails its check
  (purity must be an app stamp or a karat label; weight 0 to 10,000 g; a real date, not in the future; a fee needs its basis). Errors: `forbidden_origin` 403, `invalid_request` 400 (with the field), `too_large` 413, `turnstile_failed` 403, `rate_limited` 429, `scanner_busy` 503 (daily cap), `scanner_not_configured` 503, `scanner_unavailable` 502, `image_rejected` 422.
  Caps are variables: `SCAN_DAILY_CAP` 200, `SCAN_PER_VISITOR_HOUR` 10 (a visitor is a hash of the IP address; the address is never stored). Model: `GEMINI_MODEL` (default `gemini-3.5-flash-lite`).
  Cost at current prices (checked 2026-10-08): about $0.30 per million input tokens for that model, so a scan is a fraction of a cent. The free tier is "used to improve Google's products"; the paid tier is not: **turn on billing for the Gemini key before real users scan receipts** (they contain personal details).
- **Needs from the owner:** a Gemini API key (Google AI Studio); a Turnstile widget (site key + secret) from the Cloudflare dashboard; 3-5 sample receipt/hallmark photos with personal
  details covered; approval before any Cloudflare resource is created (KV namespace for the daily cap, rate-limit binding) and before deploying.

### 4b. Optional accounts + Vault sync (spec drafted 2026-10-08, owner decisions recorded; **awaiting approval before any build**)
**What it is.** An optional "Sign in with Google" that keeps your Vault, preferences and watchlist in step across your devices. **Nothing requires it**: signed out, the app works exactly as today.

**Decisions (owner, 2026-10-08)**
- **First sign-in merges both sides:** pieces on this device and pieces already in the account are all kept; the same piece (same id) is never duplicated. Nothing is ever lost.
- **Google first, email link later:** launch with "Continue with Google" only. The email sign-in link waits until the owner has a domain (workers.dev cannot send email).
- **What syncs:** the Vault, the preferences (language, display currency, decimals, price basis, simple/pro mode, theme) and the country watchlist (rates, duties, taxes). **Never synced:** the GoldAPI key, the Gemini key, the price source and spot price, the calculator's scratch state, a pending scan review.

**Principles**
1. **Local first.** LocalStorage stays the working copy on every device; the app never waits on the network. Sync is additive and runs in the background.
2. **Keys never leave the device** (GoldAPI, Gemini). A test checks the exact set of fields in a sync request.
3. **The browser never talks to the database.** Only the `paun-api` Worker does, and every query is filtered by the signed-in user's id.
4. **Self-serve deletion.** "Delete my account and all synced data" removes every row; signing out keeps the data on the device.
5. Times shown (for example "Synced 3 min ago, 11:34 GMT+8") follow standing constraint 11.

**Stack (constraint 9)**: Neon Postgres + the `paun-api` Worker, with **Better Auth 1.7.7 (pinned) running inside the Worker** and its tables in Neon.
**Decision made in 4b.2 (2026-10-08): self-hosted Better Auth, not Neon's managed Neon Auth.** Reasons from the docs: the managed service keeps its session cookie on Neon's own domain (the same third-party-cookie problem described below), registers Neon's callback URLs with Google instead of ours, hands out 15-minute tokens that need refreshing, and its Cloudflare Workers support is not documented; Better Auth documents Workers support and runs where our other code already runs.

**The cookie problem, and how the design avoids it.** `paun-web` and `paun-api` are different sites for browsers (`workers.dev` is on the public suffix list), so a login cookie set by the API would be a *third-party* cookie, which Safari and Chrome increasingly block. So: **no cookies and no redirects.**
1. The page shows **Google's own "Sign in with Google" button** (Google Identity Services). Google hands the page a signed **ID token**.
2. The page POSTs it to `POST /api/auth/sign-in/social` on the Worker. Better Auth verifies Google's signature and that the token was issued **for our client id**, then creates or finds the user and a session.
3. The `bearer` plugin returns the session token in a `set-auth-token` response header. The page keeps it and sends `Authorization: Bearer ...` on later calls (`GET /me`, and later the sync calls). Sign-out is `POST /api/auth/sign-out`.
Same-site cookies become an option only once `app.` and `api.` subdomains of one owned domain exist (4b.7). Token storage and expiry: the session lasts 30 days and refreshes daily; the app keeps the token in LocalStorage (decided in 4b.3, with the XSS trade-off written next to it).
**Only four URLs are reachable** (`sign-in/social`, `get-session`, `sign-out`, and `/me`); every other endpoint the library offers answers 404 and sign-in accepts only a Google ID token. **None of Google's own tokens is stored** (a hook blanks them; encryption stays on as a second layer).

**Data (Neon, beyond the auth tables)**
- `vault_items(user_id, id, name, weight, purity, paid_usd, date, updated_at, deleted_at)`, primary key `(user_id, id)`. `deleted_at` is a **tombstone**, so a piece removed on one device does not come back from another.
- `user_prefs(user_id, prefs jsonb, watchlist jsonb, updated_at)`.
- A server-assigned `version` per change drives "what changed since I last synced".

**Sync protocol (the Worker, JSON over HTTPS, bearer token required)**
- `GET /sync?since=<version>` returns items, tombstones and prefs changed after that version, plus the new version.
- `POST /sync` sends this device's changes: upserts and tombstones with their `updatedAt`, and prefs if changed. The server answers with its merged state.
- **Rules:** per piece, the newest `updatedAt` wins (pieces are only added or removed today, so real conflicts are rare); prefs and watchlist are whole-object, newest wins. **First sign-in:** the device pushes everything it has, pulls everything the account has, and the union is kept. `VaultItem` gains an optional `updatedAt`; pieces without one count as "old".
- **Limits:** 2,000 pieces per account, 256 KB per request, a per-user rate limit, and `x-` headers never trusted.
- Offline edits queue and sync when the connection returns. A visible status: "Synced just now", "Syncing…", "Offline: will sync later", or an error with a retry.

**UI.** A small "Sign in" control in Settings (and the header on wide screens), with one plain sentence about what it does. Signed in: the account email, "Synced …" with the time and timezone, **Sync now**, **Sign out**, **Delete my account and all synced data** (with a confirmation that says what is removed). EN and BM.

**Privacy.** Stored: the Google account id, email and name; Vault pieces; preferences and watchlist. **Not stored:** receipt photos, scan results, any key, browsing data. A **`/privacy` page** (EN/BM) says exactly this and how to delete it. Google's own help says an app that only asks for the basic sign-in details (name, email) does **not** need app verification; a privacy-policy link on the consent screen is still expected, so the page is part of 4b.6.

**Phases** (each its own branch and PR, owner commits)
| Phase | What | Owner does | Done when |
|---|---|---|---|
| 4b.1 | This spec | approves it | approved |
| 4b.2 | **Spike and foundations** | done; owner tried the test page | ✅ **done and proven 2026-10-09 (PR #20)**: a real Google sign-in on the deployed app returned the account (`POST /api/auth/sign-in/social` 200 with a bearer token, then `GET /me` 200 with the owner's id, email, name and photo). Decision: self-hosted Better Auth (above). Four auth tables in Neon through the repeatable runner `workers/paun-api/migrations/`. Tests with the real library and signed sessions. **Found by checking the database afterwards:** the library stored Google's ID token in readable form (the encryption option covers only access and refresh tokens). It expires in about an hour and holds only the identity details we keep anyway, but we never need it, so a hook now blanks every Google token before it reaches the database (tested through the library's real database path), and the one stored row was cleaned |
| 4b.3 | **Sign in, sign out, delete account** and the Settings UI | tries it on the live site | ✅ built on `feat/accounts-ui` (405 tests). **Server:** `DELETE /me` removes the user, their sessions and linked sign-ins (the log says only "account: deleted"); per-visitor hourly limits on sign-in (30) and on deletion (5), through a shared limiter in `src/rate.ts`; the temporary `/auth-test` page is gone. A hook now keeps **none** of Google's tokens. **App:** `src/lib/account.ts` (token in LocalStorage with the XSS trade-off written beside it, one shared signed-in state, offline keeps the token, a rejected token signs out quietly, deletion signs out only when the server confirms) and an **Account** block in Settings (Google's button; signed in: photo, name, email, Sign out, Delete with a confirmation). EN/BM. **Hidden until sync exists:** the block shows only with `?accounts=1` (remembered; `?accounts=0` hides it), so nobody signs in expecting sync before 4b.4. **Checked in a real browser against the real Neon database with throwaway users:** hidden by default; with the switch, Google's button renders; a saved session shows the person; Sign out clears the token and the server then refuses it (401); deleting the account took the database from 2 users to 1 (the owner's own account untouched); Malay. **Not automatable:** the real Google click, which the owner tries on the deployed app |
| 4b.4 | **Vault sync**: tombstones, first-sign-in merge, offline queue, status line; tests with two simulated devices | tries two browsers | ✅ built on `feat/vault-sync` (498 tests). **Proven on the real Neon database:** the 11 shared store rules run against Postgres with throwaway users and all pass, and deleting the users removed their pieces by cascade (24 rows to 0). **Proven in two real browsers** (one account, two devices, the real Worker and database): first sign-in with pieces on both sides gives the union with the shared piece not duplicated (and a toast on the device that received pieces); a removal on one device reaches the other and is stored as a tombstone; an old copy of a removed piece coming back from an "offline" device does not survive; a second account sees only its own pieces; the status line reads "Synced now (9 Oct 2026, 01:21 GMT+8)"; deleting the account deleted its synced pieces while the device kept its own, and the other device's next sync signed it out quietly. **Built:** migration `002_vault.sql` (applied to the Neon project), `workers/paun-api/src/vault/` (validation, the store with a Postgres and an in-memory implementation sharing one set of scenarios, the `POST /sync` handler), `src/lib/vault-sync.ts` (what to send, how to merge, the saved state), `VaultSyncRunner` (the background watcher, mounted in the app shell), the status line and **Sync now** in the Account block, EN/BM. **Known limits, stated plainly:** (a) a person who signs out and a DIFFERENT person who then signs in on the same device would have the first person's pieces merged into the second's account, because the pieces belong to the device; a "clear this device" choice at sign-out is on the list for 4b.6; (b) the cursor is rewound by 200 versions each sync to catch a change that committed just after another device read the list, which suits one person's few devices, not heavy concurrent use; (c) Preferences and watchlist are 4b.5, not yet synced. **Decision kept:** the Account block stays behind `?accounts=1` until 4b.6, because Google's consent screen is in Testing mode |
| 4b.5 | Preferences and watchlist sync | | language, currency and watchlist follow you |
| 4b.6 | `/privacy` page and publishing the Google consent screen to production (**may need an owned domain**, see the risk below) | enters the app name, support email and the privacy URL in Google Cloud | anyone with a Google account can sign in |
| 4b.7 | *Later, when a domain exists:* email sign-in link through Resend (free: 3,000 emails a month, 100 a day, one verified domain), and `app.` / `api.` subdomains | buys or points a domain; makes a Resend account | email link works |

**Tests (all phases).** Auth flow against a mocked Google; token expiry; sync merge (union, tombstone beats an older upsert, newest wins, idempotent repeat); a two-device simulation; deletion removes every row; the request-field whitelist (no key can be sent); per-user rate limit and size caps; and a real-browser check with a real Google sign-in on the live site.

**Risks to watch.** Neon's free database sleeps when idle (the first request after a pause can take about a second: the UI must never block on it); the managed-auth route may be limited to certain regions (it is AWS-only per Neon's docs); a pinned auth-library version needs deliberate upgrades; Google's "Testing" mode limits a consent screen to listed test users (up to 100) and short-lived grants, so production publishing (4b.6) matters before real users. **Open question to verify in 4b.6:** Google's consent screen wants the privacy-policy page on an *authorized domain* the publisher owns, and `workers.dev` is a shared suffix nobody can verify. If so, going public needs a domain of the owner's (about US$10 to 15 a year), which then also unlocks the email link and `app.` / `api.` URLs (4b.7). Until then Testing mode is enough to build and use it yourself.

**Needs from the owner (before 4b.2):**
- ✅ **Neon project created 2026-10-08** from the owner's logged-in Neon CLI: name `paun`, id `frosty-bird-18651199`, region `aws-ap-southeast-1` (Singapore, next to the owner's other projects), Postgres 18, default branch `main`, database `neondb`, role `neondb_owner`, free plan. The connection string is **never printed or committed**: the owner pipes it straight into a Worker secret, `bunx neonctl connection-string --project-id frosty-bird-18651199 --database-name neondb --role-name neondb_owner --pooled | bunx wrangler secret put DATABASE_URL -c workers/paun-api/wrangler.jsonc`.
- ✅ **Google OAuth client created** (client id `745030658975-4nlu1tjvdqb9ga7u0oralmf2mpqskchc.apps.googleusercontent.com`, public; it is in `workers/paun-api/wrangler.jsonc`). Its secret, `DATABASE_URL` and `BETTER_AUTH_SECRET` are set as Worker secrets (checked by name on 2026-10-08).
- 🟡 **Authorized JavaScript origins on that Google client** (needed because sign-in now uses Google's browser button, not a redirect): `http://localhost:8080` and `https://paun-web.paun-gold.workers.dev`. The redirect URIs registered earlier are harmless and no longer used.
- ✅ **Auth secret** set.
- No domain is needed for the first five phases, **but see the risk below for 4b.6**.

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
| 2a | Platform: leave Lovable + Cloudflare deploy + daily snapshot Action (see "Platform & deployment") | ✅ first Cloudflare auto-deploy confirmed (22:42 UTC, after the push to `main`); Lovable cleanup done in the housekeeping PR. 🟡 the first scheduled run DID fire (2026-10-07 01:41 UTC, about 3 h after the 22:30 slot: GitHub schedules run late) but FAILED at the publish step: the build left an untracked `market-snapshot.json` in the repo root, which blocks `git checkout data` once the data branch exists (the first, manual run only worked because the branch did not exist yet). Fixed on branch: the snapshot is built outside the repo and published by `.github/scripts/publish-snapshot.sh`, covered by 5 regression tests; to confirm after merge: run the workflow once by hand, then watch the next scheduled run |
| **2c** *(new)* | **Safety net:** PR checks (tests + typecheck on every PR), tests for the app's money math (closes G8), Vault import fix (moved here from "Pending") | ✅ built on branch `chore/housekeeping` (PR pending review): CI workflow, 25 money-math tests, strict Vault import (checked end-to-end in a real browser: merge keeps existing items; broken file, non-list and duplicates all report correctly) |
| 3 | 3C DCA Backtester (real 5-year history is already in the snapshot) | ✅ done 2026-10-07 (PR #3): engine `src/lib/dca.ts` with 23 hand-checked tests, page `/dca` (EN/BM) with a dock icon, checked in a real browser at desktop, 390 px and 360 px; live on the Worker |
| **3b** *(new)* | **Live price**: shared near-live feed for the landing page (`paun-api /spot`, Yahoo + budgeted GoldAPI backup), a one-time "add your own key" pop-up inside the app, and **price honesty** (no invented trend, plain-language copy) | 🟡 spec rewritten 2026-10-07 (section 3B) for the 100-requests-a-month limit. Run as numbered phases 3b.1 to 3b.6 (table in section 3B): 3b.1 price honesty ✅ merged (PR #5); **3b.2 timezone labels built** (branch `feat/dates-with-timezone`, PR pending); then the Worker skeleton, the Yahoo-from-Cloudflare test, `/spot`, and the landing page. The scanner reuses the same Worker later |
| 4 | 3D Receipt/Hallmark Scanner — first use of `paun-api` (needs the owner's Gemini key and a Turnstile widget) | 🟡 spec approved 2026-10-07 (section 3D). Phases 4.1 to 4.5: 4.1 ✅, 4.2 built (`/scan` against a mocked Gemini), 4.2 to 4.4 done, 4.3 front end built; next 4.6 (Beta tag, honest privacy line, optional own Gemini key) before sharing it with other people |
| **4b** *(new)* | **Optional accounts + Vault sync** (owner decisions 2026-10-08): Google sign-in (email link later, with a domain); signing in keeps the Vault, preferences and watchlist in step across devices; **everything still works without signing in**; keys are never synced | 🟡 spec written 2026-10-08 (section 4b) with owner decisions; **awaiting approval**. Phases 4b.1 to 4b.7; the first six need no domain. **Needs from the owner:** a free Neon account and project, and a Google Cloud OAuth client. Alerts (item 5) need accounts, so this comes first |
| 5 | 2 Notifications + 3E Street rates on `paun-api` + Neon (needs the owner's Neon account) | depends on 4b (alerts need accounts) |
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
