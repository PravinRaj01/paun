# Gold Investment & Trade Assistant

A fully client-side dashboard for comparing gold purchase costs across countries and analyzing individual trades. No login, no database — everything is saved in the browser.

## Pages

- `/` — Landing page: headline and short pitch, live spot-price ticker, feature highlights (watchlist, trade analyzer, arbitrage, settings), a preview of the dashboard, "Install app" prompt, and one "Open dashboard" button.
- `/dashboard` — the tool itself, with the sections below plus a settings dialog.

## Installable app (PWA)

- Can be added to a phone or desktop home screen with its own gold icon, name and splash colors.
- Works offline in the published app (not in the editor preview), since all data is already in the browser; manual spot price is used while offline.

## Dashboard sections

### 1. Header / Spot price bar
- Current gold spot price (USD per ounce) and the derived price per gram.
- Shows where the price came from (manually set or fetched) and when it was last updated.
- Dark/light mode toggle.
- Settings button.

### 2. Country watchlist
- Add, edit, remove countries. Each entry holds: country name, currency name/code, exchange rate to USD, import duty %, local tax/VAT %.
- Starts with a few sensible example countries so the dashboard isn't empty; all fully editable or deletable.
- Each card shows the effective landed cost per gram of pure gold in that country, in both local currency and USD.

### 3. Trade analyzer
Inputs: gold weight (grams), purity (24K, 22K, 21K, 18K, 14K, 10K), craftsman/making fee (toggle flat amount or per gram), melting/refining cost, and the asking price the seller quotes.

Outputs:
- Net gold value (pure gold content at spot).
- Total acquisition cost including fees, duty and tax for the selected country.
- Jeweler's premium — markup % over global spot value.
- Break-even resale price (per gram and total) — the price needed to recover everything paid.

### 4. Spread & arbitrage table
- Runs the current trade inputs against every watched country.
- Sortable table with total cost, cost per gram, premium %, and delta vs. the cheapest country.
- Highlights the best place to buy and the best place to sell.

### 5. Settings dialog
- Manually set the USD spot price per ounce.
- Optional field for a free public gold-price API key; when present, a "Fetch live price" action pulls the price directly from the browser.
- Choice of display currency basis and number formatting.
- Everything persists to LocalStorage; a reset button clears saved data.

## Calculations

- Pure gold grams = weight x (karat / 24).
- Net gold value = pure grams x spot price per gram.
- Making fee = flat amount, or per-gram rate x weight.
- Landed cost = (net gold value + making fee + melting cost) x (1 + duty%) x (1 + tax%), converted with the country's exchange rate.
- Jeweler's premium = (total cost - net gold value) / net gold value.
- Break-even resale price per gram = total cost / pure grams.

## Technical notes

- React with TanStack Start routing; landing replaces the placeholder index route, dashboard at `/dashboard`, each with its own head() metadata.
- PWA: web manifest + icons in `public/`, head tags in root; offline via `vite-plugin-pwa` (generateSW, NetworkFirst navigations), registered only from a guarded wrapper that refuses dev, iframe and Lovable preview hosts.
- State lives in a React context backed by a small LocalStorage hook (`gold-assistant:settings`, `:countries`, `:trade`), hydrated after mount to avoid server/client mismatch.
- Live price fetch is a plain client-side `fetch` guarded behind a user action; failures fall back to the manual price with an inline error.
- Dark mode via a `dark` class on the document root, persisted to LocalStorage.
- Design system tokens (colors, radii, typography) added to `src/styles.css`; no hardcoded colors in components.
- Lucide icons throughout; shadcn dialog, select, table, tabs, and input primitives.

## Open item

I'll propose a visual direction for the dashboard once you approve the scope — financial-dashboard styling with dark mode as the primary theme.
