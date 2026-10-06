# paun – Machine Learning Architecture & Development Blueprint

## 1. Executive Summary & Vision
**paun** is a bilingual (English / Bahasa Melayu) web application tailored for retail gold buyers, investors, and traders in Malaysia and internationally. 
* **Core Philosophy:** All internal pricing and mathematical calculations are anchored in **XAU/USD spot rates**, converting dynamically into local currencies (MYR, SGD, AED) and localized trade units (1 Gram, 1 Paun / 8g, 1 Mayam / 3.37g).
* **Architecture Strategy:** Currently operates as a 100% client-side React + Vite web app. To support intelligent price forecasting and automated alerts, the platform is expanding toward a **dual-model machine learning architecture** and a **serverless notification backend**.

---

## 2. Machine Learning Strategy: Regime & Volatility Forecasting

### Why Regime Forecasting over Exact Price Prediction?
Predicting exact daily spot prices (e.g., *"Gold will hit $2,714.30 on Thursday"*) almost always fails or overfits due to high signal-to-noise ratios, geopolitical shocks, and non-stationarity in raw financial prices. 

Instead, **paun** frames gold forecasting as a **Probabilistic 7-Day Regime Classification & Quantile Band** problem:
* **Target Output Classes:**
  1. `0: Bearish Retracement` (Forward 7-day return < -1.5%)
  2. `1: Sideways Consolidation` (Forward 7-day return between -1.5% and +1.5%)
  3. `2: Bullish Breakout` (Forward 7-day return > +1.5%)
* **Feature Inputs (Stationary Macro & Technical Indicators):**
  * **Technical Indicators:** RSI-14, Bollinger Bandwidth, Moving Average Spreads (20-day, 50-day, 200-day distance).
  * **Macro Drivers:** US Dollar Index (DXY) 5-day log return, US 10-Year Real Yields (TIPS) absolute change, Crude Oil returns, USD/MYR volatility.

---

## 3. Dual-Model Architecture (CatBoost + TFT)

To achieve peak predictive reliability alongside human-interpretable insights, the recommended architecture combines two complementary models:

```
                               ┌──> Model A: CatBoost (Regime Classifier) ──> [72% Flat, 20% Bull, 8% Bear]
[ Live Market Data Ingestion ] ──┤
                               └──> Model B: TFT (Multi-Horizon Quantiles)──> [$2,675 / $2,705 / $2,735]
```

### Model A: CatBoost Regime Classifier (Primary Workhorse)
* **Role:** Predicts discrete 7-day market regime probabilities.
* **Why CatBoost:** Empirical benchmarks on 30+ years of financial excess return data show that **CatBoost consistently outperforms generic zero-shot deep learning foundation models** in risk-adjusted Sharpe ratios and return stability.
* **Key Mechanism:** Uses **Ordered Boosting** to eliminate target leakage/lookahead bias when training on chronological time series.
* **Deployment:** Can run inside a Python FastAPI backend or compile to a ~2 MB **ONNX (`.onnx`) binary** running 100% client-side in the browser via `onnxruntime-web` at $0 cost.

### Model B: Temporal Fusion Transformer (TFT) (Deep Learning & Interpretability)
* **Role:** Multi-horizon sequence forecasting and feature importance ranking.
* **Key Mechanism:** Processes time-varying macro drivers with Variable Selection Networks and Attention Layers.
* **Output:** Generates **Quantile Loss prediction bands** ($P_{10}$, $P_{50}$, $P_{90}$) and explicit attention weights explaining *which* macro factor (e.g., US 10Y Real Yields vs DXY) drove the forecast.

### Evaluation of Other Architectures
* **TimesFM 2.5 / Foundation Models:** Zero-shot off-the-shelf foundation models suffer from "forecast drift" or hallucinated smooth trends when applied to noisy financial returns unless fine-tuned on financial K-lines.
* **TCN (Temporal Convolutional Networks):** Superior parallel training and memory efficiency compared to older LSTMs; excellent for client-side deep learning feature extraction.
* **Kronos:** Financial foundation model pre-trained on 12B+ K-line records; ideal for synthetic scenario stress testing.

---

## 4. Deployment & System Infrastructure Options

### Option A: Serverless FastAPI Backend (Recommended for Dual-Model)
* Host a lightweight **Python FastAPI microservice** (e.g. on Railway, Render, or Modal).
* Endpoint `/api/v1/forecast` executes CatBoost + PyTorch TFT inference and returns a unified JSON payload to `paun`:
```json
{
  "regime_forecast": {
    "bearish_prob": 0.08,
    "consolidation_prob": 0.72,
    "bullish_prob": 0.20,
    "dominant_regime": "Consolidation"
  },
  "price_bands_7d": {
    "p10_lower": 2675.00,
    "p50_median": 2705.00,
    "p90_upper": 2735.00
  },
  "macro_drivers": {
    "primary": "US 10Y Real Yields (38%)",
    "secondary": "US Dollar Index DXY (34%)"
  }
}
```

### Option B: 100% In-Browser Execution ($0 Server Overhead)
* Train CatBoost in Python, export to `.onnx`.
* Run inference directly inside `paun`'s React code via WebAssembly (`onnxruntime-web`). Runs in <2ms offline on device.

---

## 5. Price Alert & Push Notification System (Neon + Cloudflare)

* **Cloudflare Worker Cron:** Runs every 5–15 minutes to poll live gold spot feeds and evaluate active user alert rules.
* **Neon Serverless Postgres / Cloudflare D1:** Stores user-configured threshold triggers (e.g., *"Notify when Gold 916 < RM 385/g"* or *"Dubai vs MY spread > 7%"*) and Web Push subscription endpoints (`PushManager`).
* **Delivery Channels:** Web Push API (native browser notifications on desktop & mobile PWA) + optional Telegram Bot webhook fallback.

---

## 6. High-Value Product Roadmap for `paun`

1. **Dollar-Cost Averaging (DCA) Backtester & Planner:** 100% client-side tool allowing users to simulate buying 1g or 1 Paun monthly vs keeping cash in Fixed Deposit (FD) over 1, 3, or 5 years.
2. **Receipt & Hallmark AI Vision Scanner:** Multimodal OCR scanner that parses photos of physical jewellery receipts or hallmark stamps (916, 999.9, 22K) and extracts purity, weight, and *upah* (workmanship fees) into the Personal Vault.
3. **Zakat Emas Calculator:** Localized MY zakat liability calculator evaluating held investment gold vs worn jewellery against state *uruf* thresholds.
4. **Upah & Resale Breakeven Analyzer:** Calculates the spot price appreciation required to break even after shop workmanship charges and buyback melting discounts (10%–25%).

---

## 7. Associated Project Artifacts
* **`gold_dual_model_pipeline.py`**: Complete Python pipeline script including Yahoo Finance data ingestion, technical feature engineering, time-series cross-validation, and CatBoost model training.
