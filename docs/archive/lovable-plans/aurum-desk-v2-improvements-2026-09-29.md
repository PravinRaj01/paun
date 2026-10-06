# Aurum Desk — v2 improvements

Four upgrades to the existing dashboard, still fully client-side (LocalStorage, no login). All four were requested by the user and validated.

## 1. Base currency (display currency is configurable)

- New setting `baseCurrency` in Settings (default `USD`), chosen from the currencies of watched countries plus USD.
- All internal math stays in USD; only the display layer converts, using the exchange rate of the country in the watchlist whose currency matches the base (custom rate entry if the base currency isn't in the watchlist).
- Trade inputs (making fee, melting, asking price) are entered **in the base currency** and converted to USD internally.
- Every USD-labeled figure on the dashboard (spot bar, analyzer metrics, cost breakdown, arbitrage table totals/per-gram/deltas) shows the base currency instead. Local-currency columns in the arbitrage table stay as-is.

## 2. Comparison controls in Spread & arbitrage (GSMArena-style)

- Checkbox chips above the table to include/exclude each watched country from the comparison (selection persists in LocalStorage; new watchlist countries are included by default).
- Best-buy / best-sell / max-spread cards and the table compute only over included countries.
- Head-to-head compare: two pick slots ("Compare A vs B") showing the two countries side by side with direct deltas — total cost, cost per gram, premium %, and which one wins.

## 3. Pick countries from a built-in catalog in the Watchlist

- "Add country" opens a searchable picker from a built-in catalog (~40 countries, each with currency code and sensible default duty/VAT and an indicative FX rate).
- Picking one adds it fully populated; the user then only tweaks numbers if needed. Everything stays editable/deletable as today.
- A "Custom" option keeps manual entry for countries not in the catalog.
- Catalog ships with a note that FX rates and taxes are indicative defaults the user can edit — no live FX feed (client-side app).

## 4. Two experience modes: Simple and Pro

- Toggle in the spot bar, persisted in settings (default: Simple for first-time visitors).
- **Simple** — plain-language, no jargon: weight, karat, country and the seller's asking price only. Shows one big verdict card: "You're paying about X above the gold's value — fair / pricey / expensive", the all-in price per gram in the local currency, and a simple best-country hint. Fees, duty/VAT breakdown, premium % and break-even are hidden.
- **Pro** — everything that exists today, unchanged (full analyzer, cost breakdown, arbitrage table, comparison controls).

## Files touched

- `src/lib/gold.ts` — settings type + base-currency conversion helpers; verdict logic for Simple mode.
- `src/lib/country-catalog.ts` (new) — catalog data.
- `src/lib/gold-store.tsx` — persist new settings fields (`baseCurrency`, `mode`, comparison selection).
- `src/components/gold/SpotBar.tsx` — mode toggle.
- `src/components/gold/SettingsDialog.tsx` — base-currency picker.
- `src/components/gold/TradeAnalyzer.tsx` — base-currency amounts; Simple-mode verdict card.
- `src/components/gold/Arbitrage.tsx` — include/exclude chips, head-to-head compare.
- `src/components/gold/Watchlist.tsx` — catalog picker.

## Calculations (unchanged core, plus display conversion)

- All existing formulas stay as-is in USD.
- Display conversion: `display(n) = n * baseRate` where `baseRate` is local units per 1 USD for the base currency.
- Input conversion: `usd = amount / baseRate`.
- Simple-mode verdict: compare asking price against computed total acquisition cost — within 5% = "fair", 5–15% = "pricey", >15% = "expensive"; below cost = "good deal".
