# Where each guide claim comes from

The Gold guide (`src/components/gold/GoldGuide.tsx`, text in `src/locales/{en,ms}.json`, keys `guide*`) says only what the research
supports. "Research" is [`docs/research/gold-pricing-2026-10.md`](research/gold-pricing-2026-10.md); "Spec" is
[`docs/calculations.md`](calculations.md). Prices and dates are as of October 2026 and the guide says so where it quotes a number.

| Page | Claim | Source |
|---|---|---|
| Reading the price board | A board lists a rate per gram per purity, in RM; upah is on top | Research section 1 (boards quote RM per gram) and section 2 |
| How a price is built | Price = weight × rate + upah; the rate is the gold's value plus the shop's mark-up | Spec sections 2 and 3 (buy check); Research section 1 (shop rates run about +1% to +26% over metal) |
| 916 or 999 | 916 is 22K, 91.6% pure, usual for jewellery in Malaysia; 999 is almost pure 24K, sold as bars and coins | `PURITIES` in `src/lib/gold.ts`; Research sections 1 and 6 |
| Purity stamps | A stamp is the maker's claim; ask for the purity on the receipt | Research section 7 (a receipt shows the purity claim); arithmetic of `PURITIES` |
| Upah | Charged per piece or per gram; plain designs carry little; not returned on sell or trade-in | Research section 2 |
| Susut and buy-back rate | Susut is a % off the shop's selling rate; many shops post a buy-back rate instead, the same gap | Research section 3; Spec section 4 (sell check) |
| Trade-in or cash | Trade-in often credits a little more than cash; RM 490 vs RM 485 per gram | Research section 1 ("Reading it", one dealer, October 2026) |
| Tax on gold jewellery | No sales tax on gold jewellery in Malaysia (Treasury, June 2025); Singapore GST 9% and UAE VAT 5%, on upah too | Research section 4 (The Star; P.U.(A) 175; IRAS; ClearTax UAE) |
| Receipt checklist | Item and purity, weight in grams, the day's rate, upah on its own line, stones, exchange and buy-back terms | Research section 7 |
| Grams first | Tahil 37.5 g, mayam about 3.33 g, paun about 8 g (South India) | Research section 5 |
| Bank gold accounts | 999.9, no upah, gap about 1% to 5.5%, several cash-only; Public Gold about 7.5% | Research section 6 |
| Before you buy | Ask for rate, upah, buy-back rate; weight × rate + upah matches the total | Spec section 3 |
| Before you sell | Ask several shops for buy-back or susut and any fee; compare payouts; upah does not come back | Research sections 2 and 3; Spec section 4 |

## Not claimed

- An official Malaysian standard for susut or upah (none was found; Research section 8).
- That any shop's price is "fair": the guide describes how prices are built and leaves the judgement to the shopper.
- Anything about the 2025 sales tax order's text for heading 71.13 (not opened; the guide quotes the Treasury statement only).
