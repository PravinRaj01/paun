# Paun: plan (master reference)

Last updated: 2026-10-14 · Owner: Pravin Raj

> The detailed plan that grew up to this point (ML pipeline, daily snapshot, live price, scanner, optional accounts and sync) is kept
> unchanged in [`docs/archive/PLAN-2026-10-pre-reset.md`](docs/archive/PLAN-2026-10-pre-reset.md). Comments in the code that say
> "PLAN.md 4b.4", "3b.5" and so on point into that file.

## 1. What Paun is for

> Paun helps an ordinary person in Malaysia, on their phone, answer four questions in RM, at home or at the jewellery counter:
> 1. **What is gold worth today?**
> 2. **Is this shop's price fair, and what am I paying for: gold or workmanship?**
> 3. **What should I get if I sell or trade in?**
> 4. **What is my gold worth now?**

Every feature must help one of these. Anything else goes to **More** or waits. Pro mode is the same screens for the same shopper, with
the workings shown and the assumptions editable; it is not a trader's mode.

## 2. Why a reset (2026-10-14)

Over 60-odd commits the app drifted into a trader and tech showcase: eight dock entries, arbitrage, a futures chart, a forecast, a
five-year backtest, API keys, JSON export and a 41-country duty editor, with a plan file that was mostly ML, backend and accounts. Its
builder could no longer say what it was for or whether its maths was right. A read-only audit found:

| # | Finding | Fixed in |
|---|---|---|
| L1 | Every RM figure uses a hard-coded 4.45 MYR/USD while the app's own snapshot holds the real rate (about 4.10), so RM figures are about 9% high | #27 |
| L2 | Simple mode silently adds a USD 4/g making fee and a 6% mark-up to the "fair price" it judges the shop against | #27 |
| L3 | The verdict (good / fair / pricey / expensive at 0 / 5 / 15%) compares the shop with Paun's own guess; the copy "% above what this gold is worth" is wrong | #27, #28 |
| L4 | Import duty and tax are applied on top of upah and the assumed mark-up | #27 |
| L5 | "Break-even" is really the cost per gram; "premium over spot" includes upah, duty and the assumed mark-up | #27 |
| L6 | Buy and Sell share one asking-price field, so a buy quote shows up as the "shop's offer" on Sell | #27 |
| L7 | "Add to Vault" with no price typed saves Paun's own estimate as the price paid | #27 |
| L8 | The Vault stores the price paid as USD at the day's rate, so correcting a rate rewrites history; its sell value always uses 5% susut | #27 |
| L9 | Arbitrage "Sell here" is the most expensive place to *buy*, so the "spread" is not money anyone can make | #27 |
| L10 | The same maths is re-implemented per page ("cheapest country" in five places, sell value computed two ways) | #27 |
| L11 | An unknown purity silently becomes 916; a zero payout divides by zero | #27 |
| L12 | Display currency defaults to USD; Singapore and EU jewellery tax defaults are wrong | #27, #28 |

Sound already: the troy-ounce constant, the fineness values, and "upah is lost on resale". The existing tests prove the code does what
it says, not that what it says is right; phase 1 fixes that.

## 3. Decisions (owner, 2026-10-14)

- **Four core jobs** as above. Everything else is secondary.
- **Extras move to a More page**; nothing is deleted: price history, next-week range, monthly plan, compare countries, the globe.
- **Board rate first.** The shopper types the per-gram rate the shop posts; Paun checks the maths and splits gold from workmanship. It
  stops presenting its own guess of a shop's mark-up as the "fair price". Raw gold value is shown as a reference, never as "what it
  should cost".
- **Keep Buy here / Sell here**, with its logic fixed: *Buy here* = lowest total, *Sell here* = highest payout (buy-back), and the spread
  is what you lose buying and selling back at one shop.
- **Countries:** Malaysia first, plus Singapore, UAE and India as rough estimates in More.
- **Online-only.** No service worker (unchanged). The installed app shows an honest offline state.
- **Pro** = workings + editable assumptions. **Accounts and sync** are merged and frozen behind `?accounts=1`; no further account work
  (privacy page, domain, alerts) until the core is right.
- **Grams are the headline unit.** The name Paun stays (Tamil பவுன், about 8 g), but nothing is quoted per paun as a main figure.
- **Copy diet:** fewer words on core screens (rules in section 6).

## 4. What research established (sources dated October 2026)

Phase 1 ([#26](https://github.com/PravinRaj01/paun/issues/26)) writes this up in full with links; the conclusions that drive the design:

**Real shops, 916 gold, RM per gram** (metal value of 916 that day: about RM 505, from 4,187 USD/oz and 4.0983 MYR):

| Item | RM/g | vs metal value |
|---|---|---|
| Independent local shops, sell rate | 510 - 525 | +1% to +4% |
| AnyGold, Joyalukkas, Habib / Poh Kong, Emas MAX, sell rate | 522 - 535 | +3% to +6% |
| Public Gold jewellery, sell rate | 565 | +12% |
| Branded mall chains (shopper reports) | 600 - 610 | +19% to +21% |
| FGJAM "recommended" retail | 635 | +26% (a recommendation, not a shop's price) |
| **Buy-back rate (harga beli)**, all dealers | 487 - 497 | **-1.6% to -3.6%** |

1. **A shop's sell rate is not one number** (+1% to +26% over metal). Hence board rate first. The old fixed 6% mark-up was a fair mid-point;
   the large error was the stale exchange rate (RM 582/g instead of RM 536/g for 916).
2. **Upah is not recovered on resale.** Typical: RM 30-150+ per piece, or RM 10-30 per gram on intricate pieces. Some shops say "no upah"
   but build it into the per-gram rate: `(total - stated upah) / grams` against the board catches it.
3. **Susut nilai** is a percentage of the shop's own selling price for that purity, taken when you sell or trade in; payout =
   weight x sell rate x (1 - susut %). Reported figures vary from about 5% to 40% by source and shop. Many shops now post a **buy-back
   rate per gram** instead, which describes the same gap. Cash usually gets less than trade-in (tukar). The Sell check accepts either form.
4. **Malaysia: the customer pays no sales tax on gold jewellery.** The Treasury secretary-general said so on 26 June 2025
   ([The Star](https://www.thestar.com.my/news/nation/2025/06/27/gold-not-subject-to-sst-due-to-investment-cultural-economic-reasons-says-treasury-sec-gen));
   the [2022 exemption order](https://mysst.customs.gov.my/wp-content/uploads/2025/03/Sales-Tax-Goods-Exempted-From-Tax-Order-2022_PUA175.pdf)
   exempts all of heading 71.13. The text of the 2025 order could not be opened; secondary sources say jewellery stays exempt. Malaysia has
   **no tax field** in the app.
5. **Singapore:** 9% GST on jewellery *and* on making charges; only 99.5%+ bars and approved coins are exempt; the trade-in concession
   applies only to customers not registered for GST (from 1 January 2025). **UAE and India** figures come from secondary sources only
   (UAE 5% VAT on jewellery including making charges; India reportedly raised gold import duty to 15% in May 2026) and are shown as
   "indicative, check locally".
6. **Units:** troy ounce 31.1035 g; tahil 37.5 g (Malaysian trade); mayam about 3.33 g. Paun/pavan/savaran is a South Indian unit of about
   8 g from the British sovereign; Malaysian boards quote RM per gram, and no source shows Malay or Chinese buyers using paun.
7. **Bank gold accounts and Public Gold** sell 999.9 with 1-8% spreads and no upah; banks do not buy back physical bars over the counter.

## 5. Features

| Core (main screens) | More page | Frozen (no new work) | Removed from the UI |
|---|---|---|---|
| **Today**: RM per gram, time, source | Price history chart | Accounts and sync (merged, behind `?accounts=1`) | Old Arbitrage "A vs B" selects and sortable table (its Buy here / Sell here tiles return, rebuilt, in Check price) |
| **Check price**: Buy, Sell / trade-in, Buy here / Sell here | Next-week range | Alerts, street rates | 41-country catalog and duty/VAT editor (trimmed to MY, SG, AE, IN) |
| **My gold** (Vault, receipt scanner in Beta) | Monthly plan | ML research (bench, TFT, regime model) | Raw / shop-price toggle |
| **Guide** | Compare countries | | First-visit live-price pop-up |
| | The globe; Advanced settings (GoldAPI key, Gemini key, decimals, export/import) | | |

The daily snapshot job keeps running: it is the source of the gold price and the exchange rate.

New dock (five entries, labels always visible): **Today · Check price · My gold · Guide · More**.

## 6. How the numbers and words should behave

**Calculation rules** (specified in `docs/calculations.md`, phase 1; one engine, phase 2):
- Raw gold value = weight x fineness x (USD/oz / 31.1035) x USD/MYR from the snapshot. A reference, never "fair price".
- Buy check: weight x the shop's rate + upah = expected total; does the shop's quote add up; what you pay over raw gold, split into the
  shop's margin on the gold and the workmanship; roughly what you would get back today (upah is lost).
- Sell / trade-in check: weight x the shop's buy-back rate, *or* weight x its sell rate x (1 - susut %); shows the other figure so shops that
  quote differently can be compared; a separate trade-in rate; with neither, an estimate from raw value minus 3%, labelled as an estimate.
- Buy here / Sell here: up to four quotes. Buy here = lowest total; Sell here = highest payout (shops with no buy-back rate are left out,
  never guessed); round-trip loss per shop.
- My gold: price paid stored in the currency paid; value now = raw gold value; estimated sell uses the same sell check. One piece gives the
  same numbers on every page.
- Malaysia adds no tax. Singapore, UAE and India rules apply only in More's rough country estimates; duty is never applied on upah.

**Copy rules** (new work and phase 3):
1. A result is one plain sentence plus the number.
2. Labels are one to three everyday words; no jargon (spot, basis, premium, break-even, spread, futures). Where a trade word is needed use
   the shopper's (upah, susut, harga jual / beli) and link it to the guide.
3. One short disclaimer per page, at the bottom.
4. Source and time are short by default ("Today 11:34 GMT+8"); the full line sits behind an info tap. The timezone is always visible.
5. Caveats go behind "How is this worked out?" (open in Pro). No stacked footnotes.
6. Badges only when actionable ("Offline", "Price is 3 days old").
7. Privacy, keys and scanner explanations live in Advanced settings or the guide, with one line where the action happens.
8. Core-screen strings: at most 20 words, enforced by a copy report in CI.

## 7. Phases

Each phase is one issue, one branch, one PR. Claude does the git steps of the SOP; the owner reviews and merges.

| Phase | Issue | Gate | Done when |
|---|---|---|---|
| 0. Refocus the plan | [#25](https://github.com/PravinRaj01/paun/issues/25) | | this file, README and AGENTS.md match the new direction |
| 1. Calculation spec | [#26](https://github.com/PravinRaj01/paun/issues/26) | **owner approves before phase 2** | `docs/calculations.md` and `docs/research/` written, every number sourced or labelled an assumption |
| 2. One engine, bugs fixed | [#27](https://github.com/PravinRaj01/paun/issues/27) | phase 1 approved | L1-L12 fixed; each worked example is a test; one piece gives identical numbers on every page |
| 3. Declutter | [#28](https://github.com/PravinRaj01/paun/issues/28) | phase 2 merged | five-item dock, Check price tabs, More page, copy diet |
| 4. Guide rewrite | [#29](https://github.com/PravinRaj01/paun/issues/29) | phase 1 approved | topics in `en.json` / `ms.json`, scrollable, sourced |
| 5. Mobile and PWA polish | [#30](https://github.com/PravinRaj01/paun/issues/30) | phase 3 merged | manifest, inputs, dialogs, offline state, acceptance walk-through |

**Acceptance walk-through** (end of phase 5; 360 px and 390 px, EN and BM, light and dark, installed on Android Chrome and iOS Safari):
1. *At a counter:* a 10 g 916 chain, the shop's rate, its upah, its quoted total, and the check says whether the total adds up, the gold
   vs upah split, and the "if sold today" figure.
2. *At home, selling an old bangle:* weight, 916, the shop's buy-back rate or susut %, its offer, and the expected payout vs the offer.
3. *My gold:* add that chain; the same numbers as scenario 1; correct the exchange rate and the price paid does not change.

## 8. Standing constraints

1. **Client-side state first.** App state lives in `src/lib/gold-store.tsx` (React context + LocalStorage). Optional sign-in with sync exists
   but nothing may ever require it.
2. **Gold maths in USD, display in the chosen currency.** Amounts the shopper paid are stored in the currency they paid (phase 2).
3. **Melting, susut and buy-back apply only when selling.** Never when buying.
4. **PWA is manifest-only**, no service worker, to avoid stale-cache risk with SSR.
5. **Bilingual:** copy in `src/locales/{en,ms}.json`; trade words (upah, susut, harga jual / beli) are not machine-translated.
6. **Vendor stack:** Neon Postgres and Cloudflare Workers for any backend; Gemini and Groq for AI, called only from the Worker. Never
   Lovable AI Gateway, Lovable Cloud or Supabase. Secrets are Worker secrets, never in client code (the one exception is a Gemini key a
   user supplies for their own scans, kept only in their browser).
7. **Every date or time states its timezone**, formatted only through `src/lib/datetime.ts`.
8. **Forecast = a daily precomputed snapshot**, never computed server-side or fetched from a vendor in the client. Regime probabilities
   are hidden unless the snapshot says `regime_shipped`.
9. **`main` always works** and deploys on push; no force-push; automated data commits go only to the `data` branch.
10. **Shopper-first test:** a new feature must serve one of the four jobs or it goes to More.

## 9. Status of earlier work (details in the archive)

| Area | State |
|---|---|
| Daily snapshot, forecast bands, price chart (ML-0 to ML-6) | Done. Regime model not shipped (rule A4); bands only |
| Platform: Cloudflare Workers, auto-deploy, snapshot Action | Done |
| Monthly plan (DCA backtester) | Done, moves to More |
| Live price feed (`paun-api /spot`, Yahoo with budgeted GoldAPI backup) | Done |
| Receipt scanner (Gemini, Turnstile, multi-piece review, own key) | Done, Beta; owner's own-photo trial still pending |
| Optional accounts, Vault sync, preferences and watchlist sync | Done (PRs #20-#24), behind `?accounts=1`, frozen |
| Privacy page, Google consent screen to production, email sign-in | Parked until the core is right |

## 10. Parked

Price alerts and push; street-rate crowdsourcing; ML benchmark against pretrained forecasters; TFT challenger; Ar-Rahnu calculator; zakat
on gold (nisab 85 g; uruf by state); resale break-even analyser; Groq fallback for the scanner.
