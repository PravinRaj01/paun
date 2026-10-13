# How Paun calculates

**Status: approved 2026-10-14** ([#26](https://github.com/PravinRaj01/paun/issues/26), PR #32). Phase 2
([#27](https://github.com/PravinRaj01/paun/issues/27)) implements it in `src/lib/gold.ts`, and every worked example below is a test in
`src/lib/gold.test.ts`. Still to come in phase 2: the Vault stores the price paid in the currency paid (section 6).

Sources and dates for the facts used here are in [`docs/research/gold-pricing-2026-10.md`](research/gold-pricing-2026-10.md).

## 0. How to read this

Every input is one of three kinds, and the app labels it the same way:

| Mark | Kind | Meaning |
|---|---|---|
| **F** | Fact | Has a source and a date. Shown with its time and source. |
| **S** | Shopper's own input | Typed by the person: the shop's rate, upah, weight, offer. |
| **A** | Assumption | A default Paun supplies when the shopper has no figure. Labelled "estimate" on screen, editable in Pro, listed in section 9. |

Rules that hold everywhere:
- Money is computed unrounded and shown to 2 decimals. Weights are grams. Purity is a stamp (999.9, 999, 916, 750 ...), never a guess.
- A weight of zero or less, a rate of zero or less, a negative upah, or an unknown purity is rejected with a message, not silently fixed.
- A payout is never negative.
- **Malaysia has no tax step.** Sales tax is not charged on gold jewellery, and whatever tax exists is already inside the shop's rate.
- **Upah is never recovered when you sell.** Every selling formula uses gold weight only.

## 1. Shared inputs

| Input | Kind | Source in the app | Notes |
|---|---|---|---|
| Gold price, USD per troy ounce | **F** (or **S** if the shopper types it) | Latest daily close of gold futures from the snapshot (a New York trading day), or the shared live feed (landing page only), or the shopper's own GoldAPI key | It is a futures price, not spot; the label says so. A price the shopper set is never overwritten. |
| USD to MYR | **F** | `fx.MYR` in the snapshot, with its date; the shopper can override it in Advanced | Replaces the hard-coded 4.45 |
| Grams per troy ounce | **F** | 31.1034768 | |
| Fineness | **F** | Stamp / 1000: 999.9 -> 0.9999, 999 -> 0.999, 916 -> 0.916, 835 -> 0.835, 750 -> 0.750, 585 -> 0.585, 375 -> 0.375 | 375 (9K) is added; unknown stamps are rejected |
| Display currency | **S** | Defaults to MYR | Display only; gold maths does not depend on it |

## 2. Raw gold value (the reference number)

What the pure gold in a piece is worth at the market price, in RM. It is a reference, **never** called a fair price or a shop's price.

```
metalPerGram(purity)  =  fineness × (USD per oz / 31.1034768) × USDMYR
rawGoldValue          =  weight × metalPerGram(purity)
```

**Example 2.1** (inputs used in every example below: gold 4,187 USD/oz, USD/MYR 4.0983, as published 13-14 Oct 2026; example inputs, not live)

| Purity | RM per gram of metal | 10 g piece |
|---|---|---|
| 999 | 551.14 | 5,511.4 |
| 916 | 505.35 | 5,053.51 |
| 750 | 413.77 | 4,137.7 |

(Pure gold, fineness 1.0, is RM 551.69/g; 999 uses 0.999 and 999.9 uses 0.9999, which gives 551.64.) This is the number the Today screen shows per
gram, labelled "metal value", with its time, timezone and source.

## 3. Buy check (at the counter)

**Shopper enters (S):** weight, purity, the shop's posted rate per gram for that purity, upah (per gram *or* per piece), and
optionally the total the shop quoted. **Optional (S):** the shop's buy-back rate per gram, or its susut %.

```
goldPart        = weight × shopRate
upahPart        = upahPerGram ? upah × weight : upah
expectedTotal   = goldPart + upahPart
addsUp          = quotedTotal given  AND  |quotedTotal − expectedTotal| ≤ RM 1.00      (A: shops round to whole ringgit)
difference      = quotedTotal − expectedTotal          // positive = shop asks more than rate and upah explain
raw             = rawGoldValue(weight, purity)
shopMargin      = goldPart − raw          // what the rate adds over the metal;  shopMarginPct = shopMargin / raw
paidOverRaw     = expectedTotal − raw     // margin plus upah
upahShare       = upahPart / expectedTotal
sellBackToday   = per section 4's hierarchy (buy-back rate, then sell rate × (1 − susut), then raw × (1 − 3%))
roundTripLoss   = expectedTotal − sellBackToday
```

**What the screen says, in order:** (1) whether the total adds up (and by how much it does not); (2) "You pay RM x for the gold and RM y
for workmanship"; (3) "That is z% above the metal value"; (4) "If you sold it back today you would get about RM p; the difference is
mostly upah, which is not returned." No good / fair / expensive verdict: the thresholds had no source.

**Example 3.1: a 10 g 916 chain, shop rate RM 532.22/g, upah RM 150 per piece, quoted total RM 5,472.20**

| Line | Value |
|---|---|
| goldPart | 10 × 532.22 = **5,322.20** |
| upahPart | **150.00** |
| expectedTotal | **5,472.20** (adds up, difference 0.00) |
| raw (916, 10 g) | 5,053.51 |
| shopMargin | 268.69, which is **5.3%** over metal |
| paidOverRaw | **418.69** |
| upahShare | 2.7% |
| sellBackToday, buy-back rate known RM 497.22 | 10 × 497.22 = **4,972.20** |
| roundTripLoss | 5,472.20 − 4,972.20 = **500.00** (upah 150 + 350 from the sell/buy-back gap) |

**Example 3.2: the same piece, quoted total RM 5,622.20.** difference = **+150.00**: "RM 150.00 more than the rate and upah explain."
Ask the shop what the extra is.

**Example 3.3: no buy-back known.** sellBackToday = raw × 0.97 = **4,901.91** (an estimate, labelled); roundTripLoss = **570.29**.

**Example 3.4: "no upah" shops.** If a shop says upah is zero, the per-gram rate that matters is `(quotedTotal − upah) / weight`. Paun
shows this as "the real rate per gram you are paying" so it can be compared with a posted board.

## 4. Sell / trade-in check

**Shopper enters (S):** weight, purity, and the shop's offer. Plus **one** of the three ways to know what the shop should pay:

1. the shop's **buy-back rate per gram** (harga beli);
2. the shop's **sell rate per gram and a susut %** (the deduction a shop takes, as a percentage of its own selling price);
3. nothing: Paun estimates (A).

```
expectedPayout =
  1.  weight × buyBackRate
  2.  weight × sellRate × (1 − susutPct / 100)
  3.  rawGoldValue × (1 − 0.03)                    // estimate: published buy-backs sit 1.6% to 3.6% under metal value
payout         = max(0, expectedPayout − meltingOrTestingFee)   // fee is S, default 0; most dealers state none
offerDifference = offer − payout ; offerPct = offerDifference / payout
impliedOther    // shows route 1 as route 2 and the reverse: buy-back 497.22 against sell 532.22 = susut 6.6%
```

Upah paid when the piece was bought is **not** part of the payout. Stones and non-gold parts are not valued.

**Trade-in (tukar):** a separate optional rate `tradeInRate`. `tradeInCredit = weight × tradeInRate`. Paun shows
`credit − cashPayout` as "what you gain by trading in instead of selling for cash", and says the credit only counts towards a new piece.

**Example 4.1: 12.5 g 916 bangle, buy-back RM 497.22/g, offer RM 5,900**

| Line | Value |
|---|---|
| payout (route 1) | 12.5 × 497.22 = **6,215.25** |
| offerDifference | 5,900 − 6,215.25 = **−315.25** (−5.1%) |
| Screen | "The offer is RM 315.25 below what the shop's own buy-back rate gives." |

**Example 4.2: same piece, route 2** (sell rate 532.22, susut 7%): 12.5 × 532.22 × 0.93 = **6,187.06**; offer 5,900 is **−287.06**.

**Example 4.3: same piece, route 3** (nothing known): raw 6,316.89 × 0.97 = **6,127.38** (labelled "estimate; ask the shop for its buy-back
rate or susut %").

**Example 4.4: trade-in** (shop posts trade-in RM 490/g and cash RM 485/g, 12.5 g): credit **6,125.00** vs cash **6,062.50**: **+62.50** by
trading in.

**Why susut is a percentage of the shop's selling price:** that is how Malaysian sources define it, and it is how the old app got it wrong
(it applied 5% to the metal value instead). Reported figures vary from about 5% to 40% by source and shop, so Paun never pretends to know
the shop's number: it asks for it.

## 5. Buy here / Sell here

Compare up to four quotes for **the same weight and purity**. Per quote the shopper enters: a name, sell rate, upah, and optionally the
shop's buy-back rate.

```
total(q)          = weight × sellRate + upah
payout(q)         = weight × buyBackRate           // only if given; otherwise the quote is left out of "Sell here"
roundTripLoss(q)  = total(q) − payout(q)           // buy and sell back at the same shop
Buy here  = quote with the lowest total
Sell here = quote with the highest payout among those that gave a buy-back rate
```

Ties are shown as ties. A quote with no buy-back rate is never given a guessed payout.

**Example 5.1: 10 g 916, three shops** (rates from published boards; names omitted on purpose)

| Shop | Sell rate | Upah | Total | Buy-back | Payout | Round-trip loss |
|---|---|---|---|---|---|---|
| A | 522.30 | 0 | **5,223.00** (Buy here) | 494.75 | 4,947.50 | 275.50 |
| B | 532.22 | 150 | 5,472.20 | 497.22 | **4,972.20** (Sell here) | 500.00 |
| C | 565.00 | 0 | 5,650.00 | 491.00 | 4,910.00 | 740.00 |

The screen says: "Cheapest to buy: A. Pays most if you sell: B. Buying and selling back at A costs you RM 275.50." The *Sell here* tile
is the shop that pays the most, not the most expensive place to buy (the old logic).

## 6. My gold (the Vault)

Each piece stores: name, weight, purity, **price paid and the currency it was paid in**, date, and optionally upah and the sell basis
(a buy-back rate or susut %) the shopper saved.

```
valueNow       = rawGoldValue(weight, purity)                    // today's metal value
estimatedSell  = section 4's hierarchy, using the piece's saved basis, else raw × 0.97
profitLoss     = estimatedSell − pricePaid                        // in the currency paid; converted at today's rate if the display currency differs, and labelled
```

- The price paid is **never** recomputed when an exchange rate changes. Display conversions use today's snapshot rate.
- "Add to My gold" from a check uses the *typed* total or the expected total labelled as such; it never silently stores an estimate as
  "paid".
- One piece gives the same `valueNow` and `estimatedSell` on this screen and on the Buy and Sell checks (a test enforces it).

**Example 6.1: the chain from 3.1, bought for RM 5,472.20, no sell basis saved**

| Line | Value |
|---|---|
| valueNow | **5,053.51** |
| estimatedSell | 5,053.51 × 0.97 = **4,901.91** |
| profitLoss | 4,901.91 − 5,472.20 = **−570.29** |

Correct the exchange rate afterwards and the price paid stays RM 5,472.20; only valueNow and estimatedSell move.

## 7. Country estimates (the More page; rough on purpose)

For a traveller asking "roughly what would this cost at a counter there?" Estimates only, said so on screen:

```
estimate = ( metalLocal × (1 + retailMargin) × (1 + importDuty) + upahLocal ) × (1 + tax)
```

- `retailMargin` is one labelled assumption for every country (default **5%**, because Malaysian posted rates cluster at +3% to +6%
  over metal; the old per-country 3% and 6% values had no source). Editable per country in Pro.
- `importDuty` applies **to the metal only**, never to upah, and only where domestic gold carries it (India). Singapore and the UAE: 0.
- `tax` applies to the whole price (metal + margin + upah). Malaysia **0**. Singapore **9%** on jewellery and on making charges
  (IRAS). UAE **5%** (secondary sources). India **3%** GST on gold and 5% on making charges (2017-era source; simplified here to one
  rate, flagged). 99.5%+ bars are exempt in Singapore, so a bar is a different product; this page is for jewellery.
- UAE, India and the Indian duty figure are labelled "indicative, check locally". Duty a traveller may owe on bringing gold *home* is
  not researched and is not included; the page says so.

**Example 7.1: 10 g 916 in Singapore** (USD/SGD 1.2784, margin 5%, upah S$ 30)

| Line | Value |
|---|---|
| metal | 10 × 0.916 × (4,187 / 31.1034768) × 1.2784 = S$ **1,576.36** |
| with margin | × 1.05 = **1,655.18** |
| plus upah | **1,685.18** |
| plus GST 9% | **S$ 1,836.85** (GST S$ 151.67) |

## 8. What does not change

The price history chart, the next-week range and the monthly plan keep using the daily snapshot as they do now. The next-week range is a
likely range, not a direction. They move to the More page in [#28](https://github.com/PravinRaj01/paun/issues/28); their maths is out of
scope here.

## 9. Assumption registry

| Assumption | Default | Basis | Where editable |
|---|---|---|---|
| Estimated buy-back when no rate is known | metal value × (1 − **3%**) | Five dealers' posted 916 buy-backs sat 1.6% to 3.6% under metal value on 13-14 Oct 2026 | Pro, Advanced |
| "Adds up" tolerance | **RM 1.00** | Shops round to whole ringgit; judgement | Pro |
| Susut when the shopper gives only a sell rate and no %, offered as a starting point | **7%** | One calculator's tiers: 5% new with certificate, 7% used in good condition, 10% old, broken or no certificate | Check price |
| Country retail margin | **5%** | Malaysian posted rates, +3% to +6% | Pro |
| Weight of one paun | **about 8 g** | British sovereign convention, South India; one optional line, never a headline | none |
| Weight of one mayam / tahil | **about 3.33 g / 37.5 g** | Malaysian dealers; some Hong Kong and Singapore dealers use 37.799 g for a tahil | guide only |
| Display currency | **MYR** | Audience | Settings |

## 10. What changes from today's code

| Today | Spec | File |
|---|---|---|
| MYR rate hard-coded at 4.45; INR 83.5 and 88 in two places | Snapshot rate with date; user override | `src/lib/gold.ts:84`, `country-catalog.ts` |
| Simple mode adds a USD 4/g making fee and a 6% mark-up to the "fair cost" | The shopper enters the shop's rate and upah; no hidden additions | `gold.ts:90-100, 140-148` |
| Verdict at 0 / 5 / 15% over Paun's guess; copy "% above what this gold is worth" | Adds-up check and a plain split; no verdict | `gold.ts:131-138`, `TradeAnalyzer.tsx` |
| Duty and tax applied on top of upah and mark-up | Duty on metal only; tax per section 7; none for Malaysia | `gold.ts:146-148` |
| "Break-even" is cost per gram; "premium over spot" includes upah and duty | Removed; replaced by `paidOverRaw` and `roundTripLoss` | `gold.ts:149-151` |
| Susut 5% applied to the metal value | Susut is a % of the shop's sell rate, or a buy-back rate; else raw × 0.97 | `gold.ts:47-53, 99` |
| One asking-price field for buy and sell | Separate inputs | `gold.ts:38` |
| Add to Vault saves the estimate as "paid" when nothing is typed | A real price paid is required | `SellAnalyzer.tsx` |
| Vault stores paid as USD at the day's rate; sell value always uses 5% | Paid in the currency paid; sell uses the saved basis | `vault.tsx` |
| "Sell here" = highest retail buy price | Highest payout; round-trip loss | `Arbitrage.tsx` |
| Unknown purity becomes 916 | Rejected | `gold.ts:18-19` |
| Display currency defaults to USD | MYR | `gold.ts:75` |
| 375 (9K) missing | Added | `gold.ts:4-14` |

## 11. For the owner to approve

1. The buy check gives **no good / fair / expensive verdict**, only "adds up", the gold vs upah split and the round-trip loss. OK?
2. The three-route sell hierarchy (buy-back rate, sell rate + susut %, then raw × 0.97). OK?
3. The 3% estimate, 7% susut starting point and RM 1 tolerance in section 9. Are these sensible to you from what you see in shops?
4. "Sell here" = the shop paying the most, and the round-trip loss as the honest spread. OK?
5. Country estimates use one labelled 5% margin instead of per-country guesses. OK?
6. Gram is the headline everywhere; paun is one optional line. OK?

## 12. How the examples become tests

| Example | Test (phase 2) |
|---|---|
| 2.1 | `rawGoldValue` for 999, 916, 750 at the example inputs |
| 3.1, 3.2, 3.3 | `buyCheck`: adds up, difference +150, estimate branch |
| 4.1, 4.2, 4.3, 4.4 | `sellCheck`: routes 1 to 3 and trade-in |
| 5.1 | `compareQuotes`: Buy here A, Sell here B, losses 275.50 / 500.00 / 740.00 |
| 6.1 | My gold values and P/L; a changed exchange rate leaves "paid" unchanged |
| 7.1 | `countryEstimate` for Singapore |
| Cross-page | The piece in 3.1 gives identical `valueNow` and `estimatedSell` on Buy, Sell and My gold |
| Rejections | zero weight, zero rate, negative upah, unknown purity |
