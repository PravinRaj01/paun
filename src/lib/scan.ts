import { z } from "zod";
import { PURITIES, type PurityId } from "./gold";
import { API_BASE } from "./api";
import type { CopyKey } from "./i18n";

/**
 * The receipt scanner, browser side (PLAN.md 3D). The photo is resized in the browser, sent to our own `paun-api` Worker
 * (never to Google directly: the key lives in the Worker) together with a Cloudflare Turnstile token. The answer is a list of
 * gold pieces plus the receipt's own details; `scan-review.ts` turns it into rows the user checks before anything is saved.
 */
export const SCAN_URL = `${API_BASE}/scan`;
/** Public by design (it only identifies our widget); the matching secret lives in the Worker. `VITE_TURNSTILE_SITE_KEY` is for local tests. */
export const TURNSTILE_SITE_KEY = (import.meta.env["VITE_TURNSTILE_SITE_KEY"] as string | undefined) ?? "0x4AAAAAAFQh142918CMU2zm";

export const MAX_SIDE = 1280;

/** Scale (width, height) so the longest side is at most `max`, never enlarging. */
export function fitWithin(width: number, height: number, max: number = MAX_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!(longest > max)) return { width, height };
  const k = max / longest;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

const purity = z.enum(PURITIES.map((p) => p.id) as [PurityId, ...PurityId[]]).nullable();
const makingFee = z.object({ amount: z.number().min(0), per: z.enum(["gram", "total"]) }).nullable();
const itemSchema = z.object({
  itemName: z.string().nullable(),
  purity,
  weightGrams: z.number().positive().nullable(),
  makingFee,
  lineTotal: z.number().positive().nullable(),
});
const receiptSchema = z.object({
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  totalPaid: z.number().positive().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
});
/** What the Worker sent before multi-piece support: one piece's fields merged with the receipt's. Still understood, for the deploy window. */
const legacyFieldsSchema = z.object({
  itemName: z.string().nullable(),
  purity,
  weightGrams: z.number().positive().nullable(),
  makingFee,
  ...receiptSchema.shape,
});

export type ScanItemRead = z.infer<typeof itemSchema>;
export type ScanReceiptRead = z.infer<typeof receiptSchema>;
export type ScanResponse = {
  ok: true;
  readable: boolean;
  confidence: "high" | "medium" | "low";
  receipt: ScanReceiptRead;
  items: ScanItemRead[];
};

export const scanResponseSchema = z
  .object({
    ok: z.literal(true),
    readable: z.boolean(),
    confidence: z.enum(["high", "medium", "low"]),
    receipt: receiptSchema.optional(),
    items: z.array(itemSchema).max(20).optional(),
    fields: legacyFieldsSchema.optional(),
  })
  .refine((r) => (r.items && r.receipt) || r.fields, { message: "no items and no fields" })
  .transform((r): ScanResponse => {
    if (r.items && r.receipt) return { ok: true, readable: r.readable, confidence: r.confidence, receipt: r.receipt, items: r.items };
    const f = r.fields!;
    const piece: ScanItemRead = { itemName: f.itemName, purity: f.purity, weightGrams: f.weightGrams, makingFee: f.makingFee, lineTotal: null };
    const any = piece.itemName !== null || piece.purity !== null || piece.weightGrams !== null;
    return {
      ok: true,
      readable: r.readable,
      confidence: r.confidence,
      receipt: { purchaseDate: f.purchaseDate, totalPaid: f.totalPaid, currency: f.currency },
      items: any ? [piece] : [],
    };
  });

export type ScanFailure = { ok: false; error: string };

/** Error codes from the Worker (plus two of our own) -> the sentence the user sees. Unknown codes fall back to "unavailable". */
export const SCAN_ERROR_COPY: Record<string, CopyKey> = {
  scanner_busy: "scanErrBusy",
  rate_limited: "scanErrLimit",
  turnstile_failed: "scanErrTurnstile",
  verification_unavailable: "scanErrTurnstile",
  too_large: "scanErrTooLarge",
  user_key_rejected: "scanErrOwnKey",
  user_key_quota: "scanErrOwnQuota",
  image_rejected: "scanErrRejected",
  network: "scanErrNetwork",
  decode: "scanErrDecode",
  bad_answer: "scanErrUnavailable",
};
export const scanErrorKey = (code: string): CopyKey => SCAN_ERROR_COPY[code] ?? "scanErrUnavailable";

export async function requestScan(
  imageBase64: string,
  mimeType: "image/jpeg",
  turnstileToken: string,
  fetchImpl: typeof fetch = fetch,
  url: string = SCAN_URL,
  /** The visitor's own Gemini key, if they set one in Settings. Sent in a header, never in the body or the URL. */
  geminiKey?: string | null,
): Promise<ScanResponse | ScanFailure> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(geminiKey ? { "x-gemini-key": geminiKey } : {}) },
      body: JSON.stringify({ image: imageBase64, mimeType, turnstileToken }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    return { ok: false, error: "network" };
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code = (body as { error?: unknown } | null)?.error;
    return { ok: false, error: typeof code === "string" ? code : "unavailable" };
  }
  const parsed = scanResponseSchema.safeParse(body);
  return parsed.success ? parsed.data : { ok: false, error: "bad_answer" };
}
