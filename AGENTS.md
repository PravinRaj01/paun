<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- All app state is client-side (React context + LocalStorage in src/lib/gold-store.tsx); no backend, because the user requires no login/database.
- PWA is manifest-only (public/manifest.webmanifest); no service worker, to avoid stale-cache risk with SSR.
- Watchlist additions pick from the built-in catalog (src/lib/country-catalog.ts, indicative editable defaults) with a Custom-entry fallback.
- All internal math is USD; only display converts via the base currency (settings.baseCurrency, rate from the watchlist or settings.baseRate). Trade fee/melting/asking inputs are entered in the base currency and stored as USD.
- The landing map preserves vertical page scrolling at its home view, supports sideways one-finger exploration, and captures full pan plus pinch gestures only after zooming.
- Theme changes use the browser View Transition API with a CSS radial reveal from the header control and a reduced-motion fallback.

- UI copy lives in src/locales/{en,ms}.json loaded by i18next (bundled, offline); components use useI18n() from src/lib/i18n.ts, language persisted in settings.
- Never use Lovable AI Gateway, Lovable Cloud or Supabase. Any backend is Neon + Cloudflare Workers (workers/paun-api); AI is Gemini/Groq called only from that Worker (keys as Worker secrets, never in client code); LangChain only if genuinely needed.
