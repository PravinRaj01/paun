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

A second, separate Worker in `workers/paun-api/` (own `wrangler.jsonc`, own deploys). It answers `GET /health`, `GET /spot` (the shared live price) and `POST /scan` (the receipt scanner), both described below. Its URL will be `https://paun-api.paun-gold.workers.dev`.

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

### The receipt scanner (`POST /scan`)

Reads a photo of a gold receipt or hallmark and returns the fields it can read, for the Vault page to pre-fill (phase 4.3). The photo goes to Google's Gemini and is not
stored by Paun. It needs two secrets; until both are set the endpoint answers `503 scanner_not_configured`, so it is safe to deploy first.

One-time setup, by you (never paste a secret in chat, a file or a commit):
1. **Gemini key:** create one in Google AI Studio, then `bunx wrangler secret put GEMINI_API_KEY -c workers/paun-api/wrangler.jsonc`.
   **Turn on billing for the key's project before real users scan receipts:** on the free tier Google may use submitted content to improve its products; on the paid tier it does not.
2. **Turnstile secret** (from the widget you created): `bunx wrangler secret put TURNSTILE_SECRET -c workers/paun-api/wrangler.jsonc`.
   The widget's *site key* is public and goes in the page code, not here.
3. Optional variables in `wrangler.jsonc`: `GEMINI_MODEL`, `SCAN_DAILY_CAP` (200 scans a day for everyone), `SCAN_PER_VISITOR_HOUR` (10).

Front end: the Vault page's **Scan receipt** button talks to `https://paun-api.paun-gold.workers.dev/scan` with the public Turnstile site key (both in `src/lib/scan.ts`).
To test locally without the real widget, run the Worker (`bun run dev:api`, with `--var TURNSTILE_SECRET:1x0000000000000000000000000000000AA`) and the site with
`VITE_PAUN_API=http://127.0.0.1:8787 VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA bun run dev` (Cloudflare's always-pass test keys). Use `bun run eval:scan` to measure accuracy on a folder of photos (it also scores how many pieces each receipt lists, via `itemCount` in `expected.json`).

Locally: put dummy values in `workers/paun-api/.dev.vars` (git-ignored), for example `TURNSTILE_SECRET=1x0000000000000000000000000000000AA` (Cloudflare's always-pass test secret)
and a fake `GEMINI_API_KEY`, then `bun run dev:api`. Logs for this endpoint hold a status word and a timing only; never the photo, a token, a key, or anything the model read.

A visitor can also use **their own Gemini key** (Settings, kept only in their browser). The page sends it in an `x-gemini-key` header; the Worker uses it for that one request instead of `GEMINI_API_KEY`, skips only the shared daily cap, and never stores or logs it (a test checks the logs). Google refusing the key shows the visitor a message that names the key.

### Accounts (optional sign-in, in progress: PLAN.md item 4b)

Better Auth runs inside `paun-api`, with its tables in the Neon project `paun`. Sign-in is Google's browser button plus a bearer token (no cookies).

One-time setup, by you (never paste a secret into chat, a file or a commit):
1. **Neon:** the database exists (project `paun`). Put its address into a Worker secret without ever showing it:
   `bunx neonctl connection-string --project-id frosty-bird-18651199 --database-name neondb --role-name neondb_owner --pooled | bunx wrangler secret put DATABASE_URL -c workers/paun-api/wrangler.jsonc`
2. **Signing secret:** `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" | bunx wrangler secret put BETTER_AUTH_SECRET -c workers/paun-api/wrangler.jsonc`
3. **Google:** a Web application OAuth client in Google Cloud. Its client id is in `wrangler.jsonc` (public); its secret: `bunx wrangler secret put GOOGLE_CLIENT_SECRET -c workers/paun-api/wrangler.jsonc`.
   Under **Authorized JavaScript origins** add `http://localhost:8080` and `https://paun-web.paun-gold.workers.dev`.
4. **Tables:** `DATABASE_URL="$(bunx neonctl connection-string --project-id frosty-bird-18651199 --database-name neondb --role-name neondb_owner)" bun workers/paun-api/migrations/run.ts`
   applies the numbered files in `workers/paun-api/migrations/` once each (safe to re-run). Add changes as new numbered files; never edit an applied one.

Until all of these exist the account routes answer `503 accounts_not_configured`; nothing else is affected.
**Vault sync (phase 4b.4):** once signed in, the app keeps the Vault in step across devices through `POST /sync` (the table is migration `002_vault.sql`; apply it with the migration runner above, which has already been done for the Neon project). Deleting the account deletes its synced pieces too (`on delete cascade`). At most 2,000 pieces per account.

**Preferences and watchlist (phase 4b.5):** the same call also carries the preferences (language, display currency and its manual rate, decimals, price basis, simple/pro mode, theme) and the country watchlist, whole, newest change wins; table `user_prefs` (migration `003_prefs.sql`, already applied to the Neon project). A new device adopts what the account holds. The spot price, its source, API keys and the calculator's inputs never leave the device.

**Try it:** open the app with `?accounts=1` once (for example `https://paun-web.paun-gold.workers.dev/vault?accounts=1`), open **Settings**, and use the **Account (optional, preview)** block: Sign in with Google, then Sign out, then **Delete my account** (this really deletes it). `?accounts=0` hides the block again. The block stays hidden for everyone else until Vault sync ships (phase 4b.4).
Running the Worker locally against the real database needs the secrets and `BETTER_AUTH_URL=http://127.0.0.1:8788`: pass them as `--var NAME:value` to `wrangler dev`, or put them in the git-ignored `.dev.vars`.

## Custom domain

Add the domain to your Cloudflare account, then uncomment `routes` in `wrangler.jsonc` (or add it under Workers -> Settings -> Domains).

## Things to know

* `compatibility_date` is pinned in `wrangler.jsonc`. Bump it deliberately after testing; do not leave it to the build date.
* Do not set `main` or `assets` in `wrangler.jsonc`: Nitro owns them (it warns if you do).
* `.output/` and `.wrangler/` are build products and are git-ignored.
* The daily snapshot is fetched in the browser from GitHub's raw URL (the `data` branch), falling back to `/data/market-snapshot.json`;
  neither depends on where the site is hosted.
