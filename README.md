# Paun

**Paun** (பவுன் — Tamil for gold) is a bilingual (English / Bahasa Melayu) gold assistant for people who buy, hold and sell
physical gold in Malaysia and abroad. It runs in the browser: no login, no database — your settings and your Vault live in
your own browser's storage.

Live: <https://paun-web.paun-gold.workers.dev>

## What it does

| Page | Purpose |
|---|---|
| **Landing** (`/`) | Interactive globe of gold prices by country |
| **Markets** (`/markets`) | Real daily price history, a plain-language **price-range forecast** for the coming week, per-country cost per gram |
| **Calculator** (`/dashboard`) | Buy vs sell / trade-in: weight, purity, making fee (*upah*), melting deduction (*susut*), duty/tax, a verdict on the asking price |
| **Arbitrage** (`/arbitrage`) | Compare the same purchase across countries |
| **Vault** (`/vault`) | Personal holdings with live value, profit/loss, JSON export/import |
| **Gold Guide** | Bilingual explainer: pricing, *upah*, melting deductions, purity, the *paun* unit |

All internal maths is in USD; display converts to the chosen base currency. Melting cost applies only when selling.

## The forecast, briefly

A pipeline in `ml/` (Python) trains and evaluates two models and publishes a small **daily snapshot** (`market-snapshot.json`)
from a GitHub Action to the `data` branch. The browser fetches that file directly (with a bundled copy as the offline fallback)
and recomputes the price-range bands itself with the TypeScript port in `src/lib/forecast/`, which is parity-tested against the
Python code. Regime probabilities (bearish / sideways / bullish) are **not shown** unless the model passes every ship rule — today it
does not, so the app shows the price range only. Details: [`ml/README.md`](ml/README.md).

## Tech

TanStack Start (React 19, Vite 8) · Tailwind CSS v4 · shadcn/Radix UI · Recharts · i18next (EN/BM) · Nitro →
**Cloudflare Workers** with static assets · Vitest · Python 3.12 + CatBoost / arch for the offline ML.

## Develop

```sh
bun install
bun run dev              # http://localhost:8080
bun run test             # Vitest (forecast parity, money maths, Vault import)
bunx tsc --noEmit        # typecheck
bun run build            # production build into .output/
bun run preview:worker   # build and run it in the real Workers runtime
bun run deploy           # build + wrangler deploy (needs `wrangler login`)
```

Pushes to `main` are built and deployed by Cloudflare automatically. See [`docs/deploy.md`](docs/deploy.md).

## Where things are

| Path | What |
|---|---|
| `src/routes/` | Pages (file-based routing) |
| `src/components/gold/` | App components (calculator, charts, forecast card, vault …) |
| `src/lib/gold.ts` | Pricing maths and shared types |
| `src/lib/forecast/` | Snapshot loader, features and volatility bands (TypeScript port) |
| `src/lib/gold-store.tsx` | App state (React context + LocalStorage) |
| `src/locales/` | UI copy, `en.json` and `ms.json` |
| `ml/` | Python training, evaluation and the daily snapshot job |
| `wrangler.jsonc` | Cloudflare Worker config |
| `PLAN.md` | Roadmap, decisions and status — the single source of truth |
| `AGENTS.md` | Rules for contributors and coding agents |

Prices and fees in the app are indicative defaults the user can edit; nothing here is financial advice.
