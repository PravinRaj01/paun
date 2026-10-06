"""Market data ingestion - downloads daily closes and lines them up on gold's trading days.

WHAT   Gold futures (GC=F), US dollar index, 10Y yields (nominal from Yahoo, REAL from FRED), gold
       volatility index (GVZ), oil, USD/MYR and the S&P 500 -> one table, one row per gold session.
WHY    These are gold's classic drivers. No API key is needed: Yahoo via the `yfinance` package and
       FRED through its public CSV endpoint, so Colab, GitHub Actions and your laptop all run as-is.
HOW    Each series is reindexed onto gold's calendar and forward-filled for at most 5 sessions
       (holiday gaps). We never back-fill: that would copy the future into the past.
NOTE   The same functions feed training AND the daily snapshot job, so the model never sees inputs
       prepared differently from what it was trained on ("train/serve skew").
"""
from __future__ import annotations

import io

import pandas as pd
import requests

YAHOO = {
    "xau": "GC=F",  # COMEX gold futures (continuous); spot proxy. Roll gaps are small vs. 1.5% threshold.
    "dxy": "DX-Y.NYB",
    "us10y": "^TNX",  # nominal 10Y yield, in percent
    "gvz": "^GVZ",  # CBOE gold volatility index
    "oil": "CL=F",
    "usdmyr": "MYR=X",
    "sp500": "^GSPC",
}
FRED = {"real10y": "DFII10"}  # 10Y TIPS real yield, percent; public CSV endpoint, no API key
FX_EXTRA = {"usdsgd": "SGD=X", "usdinr": "INR=X"}  # snapshot only (AED is pegged at 3.6725)


def _yahoo_close(symbol: str, start: str) -> pd.Series:
    import yfinance as yf

    df = yf.download(symbol, start=start, progress=False, auto_adjust=False)
    if df is None or df.empty:
        raise RuntimeError(f"Yahoo returned no data for {symbol}")
    if isinstance(df.columns, pd.MultiIndex):  # recent yfinance returns (field, ticker) columns
        df.columns = df.columns.get_level_values(0)
    s = df["Close"].astype(float)
    s.index = pd.to_datetime(s.index).tz_localize(None).normalize()
    return s[~s.index.duplicated(keep="last")].sort_index()


def _fred_series(series_id: str) -> pd.Series:
    r = requests.get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}", timeout=30)
    r.raise_for_status()
    df = pd.read_csv(io.StringIO(r.text), na_values=".")
    s = pd.Series(df.iloc[:, 1].astype(float).values, index=pd.to_datetime(df.iloc[:, 0]))
    return s.dropna().sort_index()


def download_sources(start: str = "2010-01-01", with_fx_extra: bool = False) -> dict[str, pd.Series]:
    """Step 1 - download every series UNTOUCHED (each on its own calendar, with its own gaps).

    Kept separate from cleaning so the notebook can show the raw data and every cleaning step by hand.
    """
    cols = {k: _yahoo_close(v, start) for k, v in YAHOO.items()}
    if with_fx_extra:
        cols.update({k: _yahoo_close(v, start) for k, v in FX_EXTRA.items()})
    for k, sid in FRED.items():
        cols[k] = _fred_series(sid)
    return cols


def align_and_clean(sources: dict[str, pd.Series]) -> pd.DataFrame:
    """Step 2 - line everything up on gold's trading days (one row = one gold session).

    - Other series are forward-filled (max 5 sessions), never back-filled.
    - FRED values are dated the observation day but published the next morning, so the real
      yield is shifted one session to avoid a one-day lookahead.
    """
    gold_idx = sources["xau"].dropna().index
    out = {}
    for k, s in sources.items():
        aligned = s.reindex(s.index.union(gold_idx)).ffill(limit=5).reindex(gold_idx)
        out[k] = aligned.shift(1) if k in FRED else aligned
    return pd.DataFrame(out)[[*YAHOO, *FRED, *[k for k in sources if k in FX_EXTRA]]]


def build_raw(start: str = "2010-01-01", with_fx_extra: bool = False) -> pd.DataFrame:
    """download_sources + align_and_clean: the one call used by training and the daily snapshot."""
    return align_and_clean(download_sources(start, with_fx_extra))


def data_quality_report(df: pd.DataFrame, z_limit: float = 6.0) -> pd.DataFrame:
    """One row per series: how complete and how suspicious is it?

    missing_pct      share of sessions with no value
    longest_gap      longest run of consecutive missing sessions
    longest_stale    longest run where the value did not change at all (a frozen feed, not a real price)
    extreme_moves    daily changes more than `z_limit` standard deviations (spikes, bad ticks, rolls)
    first_valid      first date with a value
    """
    rows = {}
    for c in df.columns:
        s = df[c]
        na = s.isna()
        gap = na.groupby((~na).cumsum()).sum()
        same = s.eq(s.shift()) & s.notna()
        stale = same.groupby((~same).cumsum()).sum()
        ch = s.diff().dropna()
        z = (ch - ch.mean()) / (ch.std() or 1.0)
        rows[c] = {
            "missing_pct": round(100 * na.mean(), 2),
            "longest_gap": int(gap.max()) if len(gap) else 0,
            "longest_stale": int(stale.max()) if len(stale) else 0,
            "extreme_moves": int((z.abs() > z_limit).sum()),
            "first_valid": s.first_valid_index(),
        }
    return pd.DataFrame(rows).T
