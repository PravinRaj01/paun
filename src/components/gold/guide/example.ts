import { buyCheck } from "@/lib/gold";

/**
 * The guide's worked example. Same arithmetic as the Check price screen (buyCheck), with the figures a Malaysian board showed on
 * 13-14 October 2026 (docs/research/gold-pricing-2026-10.md section 1: sell about RM 524 per gram, buy-back about RM 495).
 */
export const EXAMPLE = {
  weight: 10,
  shopRate: 525,
  upah: 150,
  buyBackRate: 495,
  // only needed for the raw gold value, which the example does not show
  usdPerOz: 4187,
  fxPerUsd: 4.0983,
} as const;

export function guideExample() {
  const r = buyCheck({
    weight: EXAMPLE.weight,
    purity: "916",
    shopRate: EXAMPLE.shopRate,
    upah: EXAMPLE.upah,
    upahMode: "flat",
    buyBackRate: EXAMPLE.buyBackRate,
    usdPerOz: EXAMPLE.usdPerOz,
    fxPerUsd: EXAMPLE.fxPerUsd,
  });
  if (!r.ok) throw new Error("the guide example must be a valid check");
  return { weight: EXAMPLE.weight, shopRate: EXAMPLE.shopRate, upah: r.upahPart, total: r.expectedTotal, buyBackRate: EXAMPLE.buyBackRate, payout: r.sellBack.payout, loss: r.roundTripLoss };
}
