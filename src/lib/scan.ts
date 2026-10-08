import { z } from "zod";
import { baseRateOf, PURITIES, type Country, type PurityId, type Settings } from "./gold";
import type { CopyKey } from "./i18n";

/**
 * The receipt scanner, browser side (PLAN.md 3D, phase 4.3). The photo is resized in the browser, sent to our own `paun-api` Worker
 * (never to Google directly: the key lives in the Worker) together with a Cloudflare Turnstile token, and the answer fills the Vault
 * form. The user always sees and can change every field before anything is saved.
 */
const API = (import.meta.env["VITE_PAUN_API"] as string | undefined) ?? "https://paun-api.paun-gold.workers.dev";
export const SCAN_URL = `${API}/scan`;
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

const fieldsSchema = z.object({
  itemName: z.string().nullable(),
  purity: z.enum(PURITIES.map((p) => p.id) as [PurityId, ...PurityId[]]).nullable(),
  weightGrams: z.number().positive().nullable(),
  makingFee: z.object({ amount: z.number().min(0), per: z.enum(["gram", "total"]) }).nullable(),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  totalPaid: z.number().positive().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
});
export const scanResponseSchema = z.object({
  ok: z.literal(true),
  readable: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
  fields: fieldsSchema,
});
export type ScanResponse = z.infer<typeof scanResponseSchema>;
export type ScanFieldsRead = ScanResponse["fields"];

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

export type VaultFormPatch = { name?: string; weight?: string; purity?: PurityId; paid?: string; date?: string };
export type ScanFill = {
  patch: VaultFormPatch;
  /** Which of the form's fields could not be filled (so the page can ask the user for exactly those). */
  unread: ("weight" | "purity" | "paid" | "date")[];
  /** The receipt is in a currency we have no rate for, so the price was left for the user to type. */
  unknownCurrency: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Turn a reading into the Vault form's values. Only fields that were read are set; the rest keep what the user had.
 * The form takes the price in the user's BASE currency, so a receipt in another currency is converted with the watchlist's rate
 * (never a guessed one): if there is no rate for that currency the price is left blank and `unknownCurrency` says why.
 */
export function scanToVaultForm(
  fields: ScanFieldsRead,
  ctx: { settings: Settings; countries: Country[] },
): ScanFill {
  const patch: VaultFormPatch = {};
  const unread: ScanFill["unread"] = [];
  let unknownCurrency: string | null = null;

  if (fields.itemName) patch.name = fields.itemName;
  if (fields.weightGrams !== null) patch.weight = String(fields.weightGrams);
  else unread.push("weight");
  if (fields.purity !== null) patch.purity = fields.purity;
  else unread.push("purity");
  if (fields.purchaseDate !== null) patch.date = fields.purchaseDate;
  else unread.push("date");

  if (fields.totalPaid !== null) {
    const cur = ctx.settings.baseCurrency;
    const code = fields.currency ?? cur; // a receipt with no currency printed is assumed to be in the user's own
    if (code === cur) patch.paid = String(round2(fields.totalPaid));
    else {
      const rate = code === "USD" ? 1 : ctx.countries.find((c) => c.currency === code)?.rate;
      if (rate && rate > 0) patch.paid = String(round2((fields.totalPaid / rate) * baseRateOf(ctx.settings, ctx.countries)));
      else {
        unknownCurrency = code;
        unread.push("paid");
      }
    }
  } else unread.push("paid");

  return { patch, unread, unknownCurrency };
}
