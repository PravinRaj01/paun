> [!IMPORTANT]
> Every push to `main` is built and deployed automatically by Cloudflare (Worker `paun-web`), so keep `main` working.
> Do not force-push or rewrite history on shared branches. Automated data commits go only to the separate `data` branch.

## Direction (refocus of 2026-10-14; PLAN.md is the source of truth)

- Paun serves four shopper jobs in RM, at home or at the jewellery counter: today's price, check a shop's quote, sell or trade-in check, my gold. A new feature must serve one of them or it goes to the More page. Do not add trader or tech-showcase features.
- Grams are the headline unit. The name stays, but never quote a main figure per paun.
- Board rate first: the shopper's own per-gram rate drives the answer; never present Paun's guess of a shop's mark-up as the "fair price". Upah is never recovered on resale. Susut is a percentage of the shop's selling price, or a posted buy-back rate per gram.
- Malaysia has no sales tax on gold jewellery: no tax field for Malaysia. Singapore, UAE and India rules appear only in rough country estimates, and duty is never applied on upah.
- Copy: one plain sentence plus the number; labels of one to three everyday words; one disclaimer per page; core-screen strings at most 20 words. Details in PLAN.md section 6.
- Git: follow the SOP (issue, branch, small commits, push the feature branch, PR that closes the issue); the owner merges. No AI attribution in commits, issues or PRs.
- Accounts and sync are merged and frozen behind `?accounts=1`; no new account work until the core is right (phases in PLAN.md).
- Gold maths lives in one engine, `src/lib/gold.ts` (`buyCheck`, `sellCheck`, `compareQuotes`, `pieceValue`, `countryEstimate`), specified in `docs/calculations.md`; every worked example there is a test. Do not add gold arithmetic inside components, and change the spec before the engine.

## Rules

- All app state is client-side (React context + LocalStorage in src/lib/gold-store.tsx); no login or database is ever required. The optional sign-in with Vault, preference and watchlist sync exists behind `?accounts=1`; everything must keep working without it.
- PWA is manifest-only (public/manifest.webmanifest); no service worker, to avoid stale-cache risk with SSR.
- Watchlist additions pick from the built-in catalog (src/lib/country-catalog.ts, indicative editable defaults) with a Custom-entry fallback.
- Gold maths takes a USD price per ounce and an exchange rate as arguments (src/lib/gold.ts); the display currency is settings.baseCurrency (rate from the watchlist, which follows the daily snapshot unless the person set their own, or settings.baseRate). Amounts a person types (a shop's rate, upah, the price they paid) keep the currency they were typed in: the Trade form stores `currency` beside its amounts and the Vault stores `paid` and `currency`; the USD figure `paidUsd` is kept only as a fallback. Never rewrite what someone paid because an exchange rate changed.
- The landing map preserves vertical page scrolling at its home view, supports sideways one-finger exploration, and captures full pan plus pinch gestures only after zooming.
- Theme changes use the browser View Transition API with a CSS radial reveal from the header control and a reduced-motion fallback.

- UI copy lives in src/locales/{en,ms}.json loaded by i18next (bundled, offline); components use useI18n() from src/lib/i18n.ts, language persisted in settings.
- Never use Lovable AI Gateway, Lovable Cloud or Supabase. Any backend is Neon + Cloudflare Workers (workers/paun-api); AI is Gemini/Groq called only from that Worker (keys as Worker secrets, never in client code; the one exception is a Gemini key a user supplies for their own scans: kept only in their browser, sent per request through the Worker, never stored or logged); LangChain only if genuinely needed.
- The gold forecast is a pre-computed daily snapshot (public/data/market-snapshot.json, refreshed by a GitHub Action on the `data` branch); src/lib/forecast ports the Python features/bands to TypeScript and is parity-tested against that file (`bun run test`). Never compute forecasts server-side or call a vendor from the client. Regime probabilities are shown only when the snapshot says regime_shipped (rule A4 in ml/); otherwise the UI shows the price range only.
- Every date or time shown in the UI states its timezone: market dates are "New York trading day", moments show in the viewer's local time with the zone name, user-typed dates are "your local date". Format only through src/lib/datetime.ts, never `toLocale*` in components.
- settings.source "market" means the spot follows the latest snapshot close; "manual"/"live" are user-set and must never be overwritten automatically.
