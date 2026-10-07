/**
 * The purity stamps the app knows (`PURITIES` in src/lib/gold.ts) and the old karat labels it still reads (`LEGACY_PURITY`).
 * Duplicated here on purpose: the Worker must not import app code. src/lib/scan-parity.test.ts fails if the two ever drift apart.
 *
 * The scanner returns a stamp only when the receipt really shows one of these (or a karat label, which maps to one).
 * Anything else is null: the app's own `normPurity` would silently turn an unknown value into 916, which is exactly the
 * kind of quiet wrong answer a scanned receipt must not produce.
 */
export const PURITY_IDS = ["999.9", "999", "995", "916", "875", "835", "750", "585", "417"] as const;
export type PurityId = (typeof PURITY_IDS)[number];

export const LEGACY_PURITY: Record<string, PurityId> = {
  "24K": "999.9",
  "22K": "916",
  "21K": "875",
  "18K": "750",
  "14K": "585",
  "10K": "417",
};

/** "916", "916 ", "22K", "22 k", "22ct" -> "916"; anything unrecognised -> null. */
export function normalizePurity(raw: unknown): PurityId | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, "");
  if ((PURITY_IDS as readonly string[]).includes(s)) return s as PurityId;
  const karat = /^(\d{1,2})(K|KT|CT|KARAT)$/.exec(s);
  if (karat) return LEGACY_PURITY[`${karat[1]}K`] ?? null;
  return null;
}
