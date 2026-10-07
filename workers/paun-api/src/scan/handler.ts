import { isAllowedOrigin } from "../cors";
import type { Env } from "../env";
import { json } from "../http";
import { sanitizeScan } from "./extract";
import { callGemini, DEFAULT_MODEL } from "./gemini";
import { checkScanLimits } from "./limits";
import { verifyTurnstile } from "./turnstile";

/**
 * POST /scan  { image: <base64>, mimeType: "image/jpeg" | "image/png" | "image/webp", turnstileToken: <string> }
 *
 * In order, cheapest refusal first, and the AI last:
 *   1 origin allow-list  2 configured  3 size and shape  4 caps (read-only)  5 Turnstile  6 reserve the caps  7 Gemini  8 sanitise.
 * The photo is never stored. Logs hold a status word and a timing, never the image, the token, a key or anything the model read.
 */
const MAX_BODY_CHARS = 1_500_000; // a 1280 px JPEG is ~300 KB, ~400 KB as base64: plenty of room
const MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
// the first bytes of each format, as base64: refuses a file that is not the image it claims to be
const MAGIC: Record<(typeof MIME_TYPES)[number], string> = { "image/jpeg": "/9j/", "image/png": "iVBORw0KGgo", "image/webp": "UklGR" };

const log = (line: string) => console.log(`scan: ${line}`);

export async function handleScan(
  request: Request,
  env: Env,
  cors: Record<string, string>,
  now: Date,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const fail = (error: string, status: number, extra: Record<string, unknown> = {}) => {
    log(`${error} (${status})`);
    return json({ ok: false, error, ...extra }, status, cors);
  };

  if (!isAllowedOrigin(request.headers.get("origin"), env)) return fail("forbidden_origin", 403);
  if (!env.GEMINI_API_KEY?.trim() || !env.TURNSTILE_SECRET?.trim()) return fail("scanner_not_configured", 503);

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_CHARS) return fail("too_large", 413);
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return fail("too_large", 413);
  let body: { image?: unknown; mimeType?: unknown; turnstileToken?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return fail("invalid_request", 400, { field: "body" });
  }
  const { image, mimeType, turnstileToken } = body ?? {};
  if (typeof mimeType !== "string" || !(MIME_TYPES as readonly string[]).includes(mimeType)) return fail("invalid_request", 400, { field: "mimeType" });
  if (typeof turnstileToken !== "string" || turnstileToken.length < 1 || turnstileToken.length > 2048) return fail("invalid_request", 400, { field: "turnstileToken" });
  const type = mimeType as (typeof MIME_TYPES)[number];
  if (typeof image !== "string" || image.length < 200 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image) || !image.startsWith(MAGIC[type])) {
    return fail("invalid_request", 400, { field: "image" });
  }

  const ip = request.headers.get("cf-connecting-ip");
  const limits = await checkScanLimits(env, ip, now);
  if (!limits.ok) return fail(limits.reason, limits.reason === "rate_limited" ? 429 : 503);

  const human = await verifyTurnstile(env.TURNSTILE_SECRET, turnstileToken, ip, fetchImpl);
  if (!human.ok) return human.reason === "rejected" ? fail("turnstile_failed", 403) : fail("verification_unavailable", 502);

  await limits.reserve();
  const model = env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const result = await callGemini(env.GEMINI_API_KEY, model, image, type, fetchImpl);
  if (!result.ok) {
    log(`gemini ${result.reason}${result.status ? ` ${result.status}` : ""} (${result.ms} ms)`);
    return result.reason === "blocked"
      ? json({ ok: false, error: "image_rejected" }, 422, cors)
      : json({ ok: false, error: "scanner_unavailable" }, 502, cors);
  }

  const scan = sanitizeScan(result.data, now);
  log(`ok (${result.ms} ms, ${model}, readable=${scan.readable}, confidence=${scan.confidence})`);
  return json({ ok: true, ...scan }, 200, cors);
}
