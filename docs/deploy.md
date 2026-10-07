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

## The backend Worker (`paun-api`)

A second, separate Worker in `workers/paun-api/` (own `wrangler.jsonc`, own deploys). It answers `GET /health` and `GET /spot` (the shared live price, below); the receipt scanner follows. Its URL will be `https://paun-api.paun-gold.workers.dev`.

```sh
bun run dev:api         # runs it locally in the Workers runtime at http://127.0.0.1:8787 (no account needed)
bun run typecheck:api   # typecheck; the unit tests run with the rest: bun run test
bun run deploy:api      # first deploy / manual deploy (needs `wrangler login`)
```

**Continuous deployment (one-time dashboard setup):** Workers & Pages -> Create -> Import a repository -> pick `PravinRaj01/paun` again, and set:
* Worker name `paun-api` (must match `workers/paun-api/wrangler.jsonc`)
* Root directory `workers/paun-api`
* Build command: leave empty
* Deploy command `npx wrangler@4.147.0 deploy`
* Production branch `main`; and under Build watch paths include only `workers/paun-api/*`

Then, on the existing **paun-web** Worker, add `workers/paun-api/*` to the build watch **exclude** paths, so a backend change does not rebuild the site.

### The live price feed (`GET /spot`)

A cron trigger (Monday to Friday, every 15 minutes, UTC) asks Yahoo for the gold futures price and stores it in KV; `/spot` only reads KV, so visitors cannot use any quota.
If Yahoo fails **and** the stored price is over 30 minutes old, the Worker may make one call to GoldAPI with your key, never more than **3 a day and 90 a month**
(`DAILY_BUDGET`, `MONTHLY_BUDGET` in `wrangler.jsonc`; your plan allows 100). The counters live in KV.

One-time setup, by you:
1. **KV namespace:** nothing to create by hand. The first deploy of this version (`bun run deploy:api`, or Cloudflare's build) makes the namespace for the `SPOT` binding and prints
   a line saying so. (If it ever complains, create one in the dashboard under Storage & databases -> KV, and put its id in `kv_namespaces` in `wrangler.jsonc`.)
2. **The key, as a secret** (it is never in the repo, the browser or the chat): run this and paste the key at the prompt:
   ```sh
   bunx wrangler secret put GOLDAPI_KEY -c workers/paun-api/wrangler.jsonc
   ```
   Without the key the feed still works from Yahoo alone; the backup is simply off.
3. **Check it:** the cron fires at the next quarter hour on a weekday. Then open `https://paun-api.paun-gold.workers.dev/spot`. Before the first run it answers
   `503 {"error":"no_price_yet"}`. To see a run: dashboard -> paun-api -> Logs, lines starting `spot:` (status and timings only; no key, no bodies).
4. **Locally, no account needed:** `bunx wrangler dev -c workers/paun-api/wrangler.jsonc --test-scheduled`, then `curl "http://127.0.0.1:8787/__scheduled"` and `curl http://127.0.0.1:8787/spot`.

`/spot` answers `{priceUsdOz, fetchedAt, marketTime, provider, ageSeconds, marketOpen, stale}`. Times are UTC moments; `stale` means no new price for 45+ minutes on a weekday
(the job looks broken), `marketOpen` means the price was struck in the last 30 minutes.

## Custom domain

Add the domain to your Cloudflare account, then uncomment `routes` in `wrangler.jsonc` (or add it under Workers -> Settings -> Domains).

## Things to know

* `compatibility_date` is pinned in `wrangler.jsonc`. Bump it deliberately after testing; do not leave it to the build date.
* Do not set `main` or `assets` in `wrangler.jsonc`: Nitro owns them (it warns if you do).
* `.output/` and `.wrangler/` are build products and are git-ignored.
* The daily snapshot is fetched in the browser from GitHub's raw URL (the `data` branch), falling back to `/data/market-snapshot.json`;
  neither depends on where the site is hosted.
