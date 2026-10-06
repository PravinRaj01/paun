# Deploying Paun (Cloudflare Workers)

The front end is one Cloudflare **Worker** (name `paun-web`) that serves the server-rendered pages and the static files.
Config: `wrangler.jsonc` (committed) merged with what Nitro generates at build time into `.output/server/wrangler.json`.
The future backend (`workers/paun-api`) is a separate Worker with its own config and secrets.

## Check it locally first (no account needed)

```sh
bun run preview:worker      # builds, then runs the app in the real Workers runtime at http://127.0.0.1:8787
bunx wrangler deploy --dry-run --outdir /tmp/wd    # validates config and bundle size without uploading
```

## First deploy (needs your Cloudflare account)

```sh
bunx wrangler login         # opens a browser once
bun run deploy              # vite build && wrangler deploy  ->  https://paun-web.<your-subdomain>.workers.dev
```

The first time, wrangler asks you to register a **workers.dev subdomain** (account-wide; it appears in every Worker's URL, so pick something neutral).
Deployed: `https://paun-web.paun-gold.workers.dev`. A brand-new subdomain can refuse connections with a TLS handshake error for a minute or two
while Cloudflare issues its certificate; wait and retry, do not redeploy.

Then check on the deployed URL:
1. `/`, `/markets`, `/dashboard`, `/vault`, `/arbitrage` load; `/data/market-snapshot.json` returns JSON.
2. **Cloudflare dashboard -> Workers -> paun-web -> Metrics:** look at *CPU time* per request. The free plan allows only a few
   milliseconds of CPU per request; server-rendering React can exceed it. If you see "exceeded CPU" errors, either use the Workers
   Paid plan (about $5/month) or make the heavy pages client-only. (Local wall-clock times are 7-20 ms, but that is not CPU time and the
   local runtime does not enforce the limit, so only the real deploy settles this.)
3. **Workers Logs** (enabled in `wrangler.jsonc`) shows server-side errors.

## Continuous deployment

Connect the GitHub repo in the dashboard (Workers -> Create -> Import a repository, "Workers Builds"):
build command `bun run build`, deploy command `npx wrangler deploy`, root directory `/`. If the build environment cannot run Bun, use
`npm install && npm run build`. Production branch: `main`.

## Custom domain

Add the domain to your Cloudflare account, then uncomment `routes` in `wrangler.jsonc` (or add it under Workers -> Settings -> Domains).

## Things to know

* `compatibility_date` is pinned in `wrangler.jsonc`. Bump it deliberately after testing; do not leave it to the build date.
* Do not set `main` or `assets` in `wrangler.jsonc`: Nitro owns them (it warns if you do).
* `.output/` and `.wrangler/` are build products and are git-ignored.
* The daily snapshot is fetched in the browser from GitHub's raw URL (the `data` branch), falling back to `/data/market-snapshot.json`;
  neither depends on where the site is hosted.
