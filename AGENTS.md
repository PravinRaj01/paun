> [!IMPORTANT]
> Every push to `main` is built and deployed automatically by Cloudflare (Worker `paun-web`), so keep `main` working.
> Do not force-push or rewrite history on shared branches. Automated data commits go only to the separate `data` branch.

- All app state is client-side (React context + LocalStorage in src/lib/gold-store.tsx); no backend, because the user requires no login/database.
- PWA is manifest-only (public/manifest.webmanifest); no service worker, to avoid stale-cache risk with SSR.
- Watchlist additions pick from the built-in catalog (src/lib/country-catalog.ts, indicative editable defaults) with a Custom-entry fallback.
- All internal math is USD; only display converts via the base currency (settings.baseCurrency, rate from the watchlist or settings.baseRate). Trade fee/melting/asking inputs are entered in the base currency and stored as USD.
- The landing map preserves vertical page scrolling at its home view, supports sideways one-finger exploration, and captures full pan plus pinch gestures only after zooming.
- Theme changes use the browser View Transition API with a CSS radial reveal from the header control and a reduced-motion fallback.

- UI copy lives in src/locales/{en,ms}.json loaded by i18next (bundled, offline); components use useI18n() from src/lib/i18n.ts, language persisted in settings.
- Never use Lovable AI Gateway, Lovable Cloud or Supabase. Any backend is Neon + Cloudflare Workers (workers/paun-api); AI is Gemini/Groq called only from that Worker (keys as Worker secrets, never in client code); LangChain only if genuinely needed.
- The gold forecast is a pre-computed daily snapshot (public/data/market-snapshot.json, refreshed by a GitHub Action on the `data` branch); src/lib/forecast ports the Python features/bands to TypeScript and is parity-tested against that file (`bun run test`). Never compute forecasts server-side or call a vendor from the client. Regime probabilities are shown only when the snapshot says regime_shipped (rule A4 in ml/); otherwise the UI shows the price range only.
- settings.source "market" means the spot follows the latest snapshot close; "manual"/"live" are user-set and must never be overwritten automatically.
