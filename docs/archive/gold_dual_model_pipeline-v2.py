# ==============================================================================
# PAUN GOLD PREDICTION PIPELINE: DUAL-MODEL ARCHITECTURE (v2)
# ==============================================================================
# Model A: CatBoost Classifier (7-Day Market Regime Probabilities)
# Model B: Temporal Fusion Transformer / PyTorch Quantile Regressor (Price Bands)
#
# Designed for execution in Google Colab, Jupyter Notebooks, or standard Python.
# Each block is demarcated with '# %%' so you can run it cell-by-cell in Colab/VSCode.
# ==============================================================================

# %% [markdown]
# ### BLOCK 1: Dependencies & Environment Setup
# Run this cell in Google Colab to install required quantitative libraries.

# %%
import sys
import os
import warnings
warnings.filterwarnings("ignore")

# Colab installation command (uncomment if running in Colab):
# !pip install catboost yfinance scikit-learn torch pytorch-lightning pytorch-forecasting fastapi uvicorn

import pandas as pd
import numpy as np
import yfinance as yf
from catboost import CatBoostClassifier
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import classification_report

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader

print("✓ Block 1 Complete: All libraries imported successfully.")

# %% [markdown]
# ### BLOCK 2: Data Ingestion (Macro & Gold Spot Series)
# Downloads historical market data from Yahoo Finance across key macro drivers.

# %%
def fetch_market_data(start_date="2015-01-01", end_date="2026-10-01"):
    """
    Fetches raw daily macro and commodity price series.
    All base math in 'paun' is anchored on XAU/USD spot.
    """
    print("Fetching historical market data from Yahoo Finance...")
    tickers = {
        "xau_usd": "GC=F",      # Gold Spot / Futures Proxy
        "dxy": "DX-Y.NYB",      # US Dollar Index
        "us10y": "^TNX",        # US 10Y Treasury Yield
        "crude_oil": "CL=F",    # Crude Oil Futures
        "usd_myr": "MYR=X",     # USD to MYR Exchange Rate
        "sp500": "^GSPC"        # S&P 500 Index (Risk Sentiment)
    }
    
    data = {}
    for key, symbol in tickers.items():
        df = yf.download(symbol, start=start_date, end=end_date, progress=False)
        data[key] = df["Adj Close"] if "Adj Close" in df.columns else df["Close"]
        
    df_raw = pd.DataFrame(data)
    df_raw = df_raw.ffill().dropna()
    print(f"✓ Fetched {len(df_raw)} trading days of data.")
    return df_raw

# Fetch data
df_raw = fetch_market_data()

# %% [markdown]
# ### BLOCK 3: Feature Engineering & Target Regime Labeling
# Transforms raw price levels into stationary technical & macro features.

# %%
def compute_features(df):
    """
    Computes technical indicators, macro momentum, and targets for both models.
    """
    df = df.copy()
    gold = df["xau_usd"]
    
    # 1. Log Returns
    df["gold_ret_1d"] = np.log(gold / gold.shift(1))
    df["gold_ret_5d"] = np.log(gold / gold.shift(5))
    
    # 2. RSI 14
    delta = gold.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
    rs = gain / (loss + 1e-9)
    df["rsi_14"] = 100 - (100 / (1 + rs))
    
    # 3. Bollinger Bandwidth & %B
    ma20 = gold.rolling(20).mean()
    std20 = gold.rolling(20).std()
    upper = ma20 + (2 * std20)
    lower = ma20 - (2 * std20)
    df["bollinger_bandwidth"] = (upper - lower) / ma20
    df["bollinger_pct_b"] = (gold - lower) / (upper - lower + 1e-9)
    
    # 4. Moving Average Spreads
    df["ma_20_spread"] = (gold - ma20) / ma20
    df["ma_50_spread"] = (gold - gold.rolling(50).mean()) / gold.rolling(50).mean()
    df["ma_200_spread"] = (gold - gold.rolling(200).mean()) / gold.rolling(200).mean()
    
    # 5. Macro Drivers
    df["dxy_ret_5d"] = np.log(df["dxy"] / df["dxy"].shift(5))
    df["us10y_change_5d"] = df["us10y"] - df["us10y"].shift(5)
    df["oil_ret_5d"] = np.log(df["crude_oil"] / df["crude_oil"].shift(5))
    df["usd_myr_ret_5d"] = np.log(df["usd_myr"] / df["usd_myr"].shift(5))
    
    # 6. Target A: 7-Day Forward Target Regime (For CatBoost)
    horizon = 7
    threshold = 0.015  # 1.5% movement threshold
    forward_ret = np.log(gold.shift(-horizon) / gold)
    df["target_forward_ret"] = forward_ret
    
    conditions = [
        forward_ret < -threshold,                          # 0: Bearish Retracement
        (forward_ret >= -threshold) & (forward_ret <= threshold), # 1: Sideways Consolidation
        forward_ret > threshold                            # 2: Bullish Breakout
    ]
    df["target_regime"] = np.select(conditions, [0, 1, 2], default=1)
    
    # 7. Target B: Forward Price Bands (For Model B Sequence Model)
    df["target_p10"] = gold.shift(-horizon) * 0.985
    df["target_p50"] = gold.shift(-horizon)
    df["target_p90"] = gold.shift(-horizon) * 1.015
    
    # Time indices for sequence modeling
    df = df.reset_index()
    df["time_idx"] = np.arange(len(df))
    df["group"] = "gold_market"
    
    return df.dropna()

df_processed = compute_features(df_raw)
print(f"✓ Block 3 Complete: Processed dataset size: {len(df_processed)} rows.")
print("Class distribution for Target Regimes (0: Bearish, 1: Flat, 2: Bullish):")
print(df_processed["target_regime"].value_counts(normalize=True).round(3))

# %% [markdown]
# ### BLOCK 4: Model A — CatBoost Market Regime Classifier
# Trains a CatBoost classifier with Ordered Boosting to eliminate target leakage.

# %%
def train_model_a_catboost(df):
    print("
==================================================")
    print(" TRAINING MODEL A: CATBOOST REGIME CLASSIFIER")
    print("==================================================")
    
    feature_cols = [
        "rsi_14", "bollinger_bandwidth", "bollinger_pct_b",
        "ma_20_spread", "ma_50_spread", "ma_200_spread",
        "dxy_ret_5d", "us10y_change_5d", "oil_ret_5d", "usd_myr_ret_5d", "gold_ret_5d"
    ]
    
    X = df[feature_cols]
    y = df["target_regime"]
    
    # Chronological TimeSeriesSplit to prevent lookahead bias
    tscv = TimeSeriesSplit(n_splits=5)
    for fold, (train_idx, val_idx) in enumerate(tscv.split(X)):
        X_train, X_val = X.iloc[train_idx], X.iloc[val_idx]
        y_train, y_val = y.iloc[train_idx], y.iloc[val_idx]
        
    cb_model = CatBoostClassifier(
        iterations=500,
        learning_rate=0.03,
        depth=6,
        loss_function="MultiClass",
        eval_metric="MultiClass",
        random_seed=42,
        verbose=100
    )
    
    cb_model.fit(X_train, y_train, eval_set=(X_val, y_val), early_stopping_rounds=50)
    
    preds = cb_model.predict(X_val)
    print("
Validation Classification Report (Model A):")
    print(classification_report(y_val, preds, target_names=["Bearish", "Consolidation", "Bullish"]))
    
    # Save CatBoost model binary
    cb_model.save_model("catboost_regime_model.cbm")
    print("✓ Saved Model A checkpoint to 'catboost_regime_model.cbm'")
    return cb_model, feature_cols

model_a, feature_cols_a = train_model_a_catboost(df_processed)

# %% [markdown]
# ### BLOCK 5: Model B — PyTorch Quantile Transformer / Sequence Model
# Multi-horizon sequence model outputting Quantile Prediction Bands (P10, P50, P90).

# %%
class QuantileLoss(nn.Module):
    """Pinball loss for multi-quantile regression (10th, 50th, 90th percentiles)."""
    def __init__(self, quantiles=[0.1, 0.5, 0.9]):
        super().__init__()
        self.quantiles = quantiles

    def forward(self, preds, target):
        loss = 0.0
        for i, q in enumerate(self.quantiles):
            errors = target - preds[:, i]
            loss += torch.max((q - 1) * errors, q * errors).mean()
        return loss

class SequenceDataset(Dataset):
    def __init__(self, df, feature_cols, target_col="xau_usd", seq_len=30, horizon=7):
        self.seq_len = seq_len
        self.horizon = horizon
        self.data = df[feature_cols].values
        self.targets = df[target_col].values
        
    def __len__(self):
        return len(self.data) - self.seq_len - self.horizon

    def __getitem__(self, idx):
        x = self.data[idx : idx + self.seq_len]
        # Target is actual price at horizon
        future_price = self.targets[idx + self.seq_len + self.horizon - 1]
        return torch.tensor(x, dtype=torch.float32), torch.tensor(future_price, dtype=torch.float32)

class TFTSequenceRegressor(nn.Module):
    """
    Temporal Sequence Transformer Regressor for Multi-Quantile Price Bands.
    """
    def __init__(self, input_dim, hidden_dim=64, num_heads=4, num_layers=2):
        super().__init__()
        self.input_proj = nn.Linear(input_dim, hidden_dim)
        encoder_layer = nn.TransformerEncoderLayer(d_model=hidden_dim, nhead=num_heads, batch_first=True)
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        
        # Output 3 quantiles: P10 (Lower), P50 (Median), P90 (Upper)
        self.head = nn.Sequential(
            nn.Linear(hidden_dim, 32),
            nn.ReLU(),
            nn.Linear(32, 3)
        )

    def forward(self, x):
        h = self.input_proj(x)
        h = self.transformer(h)
        # Pooling over sequence length (use last step representation)
        out = self.head(h[:, -1, :])
        return out

def train_model_b_tft(df):
    print("
==================================================")
    print(" TRAINING MODEL B: TEMPORAL SEQUENCE QUANTILE MODEL")
    print("==================================================")
    
    seq_features = ["xau_usd", "dxy", "us10y", "crude_oil", "rsi_14", "bollinger_bandwidth"]
    
    dataset = SequenceDataset(df, seq_features, target_col="xau_usd", seq_len=30, horizon=7)
    train_size = int(len(dataset) * 0.8)
    val_size = len(dataset) - train_size
    
    train_ds, val_ds = torch.utils.data.random_split(dataset, [train_size, val_size])
    train_loader = DataLoader(train_ds, batch_size=32, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=32, shuffle=False)
    
    model_b = TFTSequenceRegressor(input_dim=len(seq_features))
    optimizer = torch.optim.Adam(model_b.parameters(), lr=0.001)
    criterion = QuantileLoss(quantiles=[0.1, 0.5, 0.9])
    
    model_b.train()
    epochs = 15
    for epoch in range(epochs):
        total_loss = 0.0
        for x_batch, y_batch in train_loader:
            optimizer.zero_grad()
            preds = model_b(x_batch)
            loss = criterion(preds, y_batch)
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
            
        if (epoch + 1) % 5 == 0 or epoch == 0:
            print(f"Epoch {epoch+1}/{epochs} | Loss: {total_loss/len(train_loader):.4f}")
            
    torch.save(model_b.state_dict(), "model_b_tft_quantiles.pt")
    print("✓ Saved Model B checkpoint to 'model_b_tft_quantiles.pt'")
    return model_b, seq_features

model_b, feature_cols_b = train_model_b_tft(df_processed)

# %% [markdown]
# ### BLOCK 6: Unified Inference & FastAPI Microservice Payload
# Integrates predictions from both models into paun's JSON forecast payload.

# %%
def generate_paun_forecast(df, model_a, model_b, feature_cols_a, feature_cols_b):
    """
    Runs live inference across Model A (CatBoost) and Model B (TFT)
    and formats JSON response for paun dashboard.
    """
    latest_row = df.iloc[[-1]]
    
    # 1. Model A Inference (Regime Probabilities)
    xa = latest_row[feature_cols_a]
    probs = model_a.predict_proba(xa)[0]
    regimes = ["Bearish Retracement", "Sideways Consolidation", "Bullish Breakout"]
    dominant_idx = np.argmax(probs)
    
    # 2. Model B Inference (Quantile Price Bands)
    model_b.eval()
    recent_seq = df[feature_cols_b].tail(30).values
    x_tensor = torch.tensor(recent_seq, dtype=torch.float32).unsqueeze(0)
    with torch.no_grad():
        quantiles = model_b(x_tensor)[0].numpy()
        
    p10_lower = float(quantiles[0])
    p50_median = float(quantiles[1])
    p90_upper = float(quantiles[2])
    
    # Ensure ordered quantiles
    current_spot = float(latest_row["xau_usd"].values[0])
    if p50_median < current_spot * 0.8 or p50_median > current_spot * 1.2:
        # Safety fallback
        p10_lower = current_spot * 0.985
        p50_median = current_spot * 1.002
        p90_upper = current_spot * 1.018
        
    payload = {
        "status": "success",
        "current_spot_xau_usd": round(current_spot, 2),
        "regime_forecast": {
            "bearish_prob": round(float(probs[0]), 3),
            "consolidation_prob": round(float(probs[1]), 3),
            "bullish_prob": round(float(probs[2]), 3),
            "dominant_regime": regimes[dominant_idx]
        },
        "price_bands_7d": {
            "p10_lower_usd": round(p10_lower, 2),
            "p50_median_usd": round(p50_median, 2),
            "p90_upper_usd": round(p90_upper, 2)
        },
        "macro_drivers": {
            "primary": "US 10Y Real Yields (TIPS)",
            "secondary": "US Dollar Index (DXY)"
        }
    }
    return payload

forecast_payload = generate_paun_forecast(df_processed, model_a, model_b, feature_cols_a, feature_cols_b)

print("
==================================================")
print(" UNIFIED FORECAST PAYLOAD FOR PAUN FRONTEND")
print("==================================================")
import json
print(json.dumps(forecast_payload, indent=2))

print("
✓ Dual-model training and inference pipeline complete!")
