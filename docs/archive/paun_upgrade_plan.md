# Paun — Feature Plans & Roadmap (Detailed)

Last updated: 2026-10-06 · Owner: Pravin Raj

This document captures everything agreed in the latest planning discussion: the
five selected next features, their full specifications, infrastructure
requirements, recommended build order, and the standing architecture rules they
must respect.

---

## Current state (context)

- **Paun** (பவுன் — Tamil for gold) is a fully client-side gold investment &
  trade assistant: no login, no database, all state in LocalStorage
  (`src/lib/gold-store.tsx`).
- Pages: Landing (interactive dot-matrix globe with live country prices),
  Markets (spot charts + watchlist), Calculator (Buy vs Sell/Trade-in),
  Arbitrage (with Active Trade strip), Vault (portfolio tracker with P&L,
  export/import), plus the bilingual (EN/BM) flip-book Gold Guide.
- Internal math in USD; display converts via the configurable base currency.
- PWA (manifest-only, no service worker). Dark/light theme with the canvas
  dot-matrix radial ripple.
- i18n: i18next with `src/locales/en.json` / `ms.json`; gold jargon
  (upah tukang, susut nilai, paun) is locked out of machine translation.

---

## The five selected features

Selected from the brainstorm: **1, 2, 3C, 3D, 3E** — per the user's correction,
**3C is the DCA Backtester & Planner** (not Ar-Rahnu; Ar-Rahnu and Zakat were
3A/3B and were *not* selected, though they remain on the ideas list).

### 1. Gold Prediction & Regime Forecasting Model

**What it does**
Instead of predicting noisy exact prices (which usually fail in macro assets —
gold follows random walks dominated by Fed decisions, DXY, geopolitics, central
bank buying), the model forecasts **probabilistic price regimes and momentum
bands**:

- *"72% probability of consolidation within $2,680–$2,720 over 7 days"*
- *"Bullish breakout regime driven by real-yield dips"*

**Key feature inputs**
- Spot momentum: RSI, Bollinger bandwidth
- US 10-Year Real Yields (TIPS)
- US Dollar Index (DXY)
- Gold volatility index (GVZ)
- Central bank net purchase flows

**Model & training approach**
- Train with **LightGBM / XGBoost** (gradient-boosted trees) or an
  **LSTM/Transformer** on historical macro data.
- Avoid raw point-forecast regression (LSTMs predicting next price always lag
  the market one step).
- Three useful outputs:
  1. **Probabilistic price cones / expected volatility** — GARCH or historical
     volatility to show 7-day and 30-day confidence ranges (68% / 95%).
  2. **Market regime classifier** — Bullish Trend / Consolidation (Range-Bound)
     / Distribution (Pullback).
  3. **Retail spread anomaly detection** — flag when jeweler spreads in
     Malaysia/Dubai deviate abnormally from their historical range vs spot.

**Deployment options**
- Export the trained model to **ONNX** or **TensorFlow.js** for 100% offline,
  zero-cost in-browser inference (fits the client-side philosophy), **or**
- Host inference on a Cloudflare Worker / small serverless endpoint (FastAPI on
  Modal, Railway, Fly.io) when inputs require fresh macro data.

**Infrastructure:** training is offline (user's own Python work: scikit-learn /
PyTorch / LightGBM). Inference can be client-side (no backend) or a Worker.

---

### 2. Price Alert & Push Notification System (Neon + Cloudflare)

**What it delivers** — instant alerts with no app-store install:
- **Threshold alerts:** *"Gold 916 fell below RM 390/g in Malaysia"*
- **Arbitrage spread triggers:** *"Dubai–Malaysia spread widened beyond 7.5%
  net margin"*
- **Weekly gold wrap-up:** weekly high/low plus a portfolio valuation summary.

**Architecture**
- **Cloudflare Worker (Cron Trigger):** polls gold prices every 5–15 minutes,
  fetches the latest spot rates, then queries the database for active alerts.
- **Neon Serverless Postgres** (or Cloudflare D1): stores user alert rules and
  Web Push subscription endpoints. Connect over HTTP via
  `@neondatabase/serverless` to avoid persistent connection-pool issues.
  - Table sketch: `alert_subscriptions` (user identifier, target price,
    direction above/below, currency, channel info).
- **Delivery channels:**
  - **Web Push (PWA native)** — standard `PushManager` API. Zero cost,
    no third-party fees; delivers to Android, iOS 16.4+ (installed PWA), and
    desktop. Primary channel.
  - **Telegram Bot webhook** — very popular with Malaysian/Southeast Asian gold
    traders; free and instant. Secondary channel.
  - **Email (Resend API)** — clean fallback for weekly digests/summaries.

**Alternative to Neon + Cloudflare:** Lovable Cloud can provision Postgres,
Auth, and scheduled edge functions inside the project with no separate billing
to manage. Decide when building.

**Infrastructure:** first real backend component of Paun — the app stops being
100% client-side when this ships.

---

### 3C. Dollar-Cost Averaging (DCA) Backtester & Planner

**What it does**
Simulates *"What if I bought 1g of 916 every month for the last 1, 3, or 5
years versus keeping that cash in a savings account?"*

**Outputs**
- Cumulative grams accumulated over the period
- Average acquisition cost per gram
- Net profit at the current spot rate vs the savings-account comparison

**Infrastructure:** pure client-side math — can be built immediately inside the
current stack with no external database, API, or AI costs. This is the
quickest win of the five.

---

### 3D. Receipt & Hallmark AI Scanner (Vision / OCR)

**What it does**
The user photographs a physical gold receipt (Habib, Tomei, Poh Kong, a local
kedai emas), a bullion certificate, or a hallmark stamp (`916`, `750`, `22K`…).
The AI extracts:

- Hallmark stamp purity (916, 999.9, 750, 22K, …)
- Item weight in grams
- Workmanship fee (upah tukang)
- Purchase date and total paid

**Result:** auto-populates a new **Personal Vault** entry with zero manual data
entry — makes the Vault feel effortless.

**Architecture:** client camera capture → multimodal vision model via the
**Lovable AI Gateway** (no separate AI vendor accounts).

**Infrastructure:** requires AI (Gateway), no database.

---

### 3E. Street Rate & Counter Board Crowdsourcing

**What it does**
Bridges the gap between online commodity spot prices and real physical counter
rates:

- Users log the counter board rates they see at major retail chains
  (Poh Kong, Habib, Tomei, Wah Chan) and local bullion/jewellery streets
  (Lebuh Ampang, Masjid India, Mustafa Singapore, Deira Gold Souk Dubai).
- The app calculates the **true retail spread** against raw spot in real time.
- *"Best Street Rate Near You"* leaderboard with crowd-verified timestamps.

**Architecture:** requires a backend (Cloudflare + Neon/D1, or Lovable Cloud)
to store, moderate, and aggregate community submissions, plus abuse/spam
moderation.

**Infrastructure:** backend database (pairs naturally with feature 2 — same
infrastructure decision).

---

## Recommended sequencing

| Order | Feature | Why now |
|-------|---------|---------|
| 1 | **3C — DCA Backtester & Planner** | Pure client-side; buildable immediately, zero infra cost |
| 2 | **3D — Receipt & Hallmark Scanner** | Next step once AI is introduced; makes the Vault effortless |
| 3 | **2 — Notification Engine** + **3E — Street Rate Crowdsourcing** | Build together when ready for a backend (they share the Neon/Cloudflare — or Lovable Cloud — decision) |
| 4 | **1 — Prediction & Regime Model** | Longest lead time; user trains models offline, then decides ONNX/TF.js in-browser vs Worker inference |

---

## Pending (carried over from the previous session)

- **Vault import validation** — currently accepts any JSON file and silently
  ignores parse errors; only keeps array items with a numeric `weight` and a
  `purity` field. Agreed plan: strict schema validation (JSON array of
  `{id?, name, weight>0, purity ∈ fineness stamps, paidUsd, date YYYY-MM-DD}`),
  legacy purity-code support (`"22K"` → `"916"`), and clear toast errors:
  *"Invalid JSON syntax"*, *"Expected an array of items"*,
  *"Imported 4 items (1 skipped: invalid purity)"*.
- GoldMap geolocation permission flow and real-phone map behavior need
  real-device verification.
- i18next auto-translation CLI not yet set up (en/ms JSON files are maintained
  manually with the locked gold-jargon glossary).

---

## Ideas parked (not selected, keep for later)

- **Ar-Rahnu (Islamic gold pawn) calculator** — Marhun value, financing margin
  65–80%, tiered upah simpan (≈ RM0.60–0.85 per RM100/month), redemption
  totals across 6/12/18-month tenures, auction-risk warnings.
- **Zakat Emas calculator** — Emas Simpanan: 85 g Nisab, 2.5% annual zakat;
  Emas Perhiasan: state-specific uruf limits (Selangor 800 g, Johor 850 g,
  Federal Territories 150 g).

---

## Standing architecture constraints (apply to everything above)

1. No login/database today — all state client-side (LocalStorage via
   `src/lib/gold-store.tsx`). Features 1 and 3C must stay client-side unless
   the user explicitly changes this.
2. All internal math in USD; display converts via `settings.baseCurrency`.
3. Melting cost applies **only** to Sell/Trade-in, never to buying.
4. PWA is manifest-only (no service worker) to avoid stale-cache risk with SSR.
5. Watchlist adds come from the built-in country catalog with a Custom
   fallback; no flags (palette protection).
6. UI copy bilingual EN/BM via i18next (`src/locales/{en,ms}.json`), with the
   gold-jargon glossary protected from machine translation.
7. When the backend phase starts (features 2/3E), decide first between
   **Neon + Cloudflare Workers** (user's plan) and **Lovable Cloud**
   (zero-setup Postgres/Auth/cron inside the project) before writing code.
