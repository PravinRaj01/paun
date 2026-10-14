import { PROMPT, RESPONSE_SCHEMA } from "./extract";

/**
 * One call to Google's Gemini (generateContent) with the photo and the extraction prompt. The key travels in a header, never in
 * the URL (URLs end up in logs). The photo is sent and forgotten: nothing here stores it, and nothing logs it or the reply.
 */
export type GeminiResult =
  | { ok: true; data: unknown; ms: number }
  | { ok: false; reason: "http_error" | "blocked" | "no_text" | "not_json" | "timeout" | "network_error"; status?: number; ms: number };

export const DEFAULT_MODEL = "gemini-3.5-flash-lite";
/**
 * Google's lite models take turns being overloaded (503) or slow: on 14 Oct 2026 the two below swapped places within minutes.
 * One bad moment on the first model should not make the scanner look broken, so a second model is tried once.
 */
export const DEFAULT_FALLBACK_MODEL = "gemini-3.1-flash-lite";
const TIMEOUT_MS = 25_000;
// With a second model to fall back to, the first one gets a shorter go, so the whole scan still ends inside the browser's 45 s.
const FIRST_TRY_MS = 16_000;
const SECOND_TRY_MS = 20_000;

export async function callGemini(
  key: string,
  model: string,
  imageBase64: string,
  mimeType: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = TIMEOUT_MS,
): Promise<GeminiResult> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  try {
    const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: PROMPT }, { inlineData: { mimeType, data: imageBase64 } }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 800,
          responseMimeType: "application/json",
          responseJsonSchema: RESPONSE_SCHEMA,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, reason: "http_error", status: res.status, ms: elapsed() };
    const body = (await res.json().catch(() => null)) as {
      candidates?: { content?: { parts?: { text?: unknown }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
    } | null;
    if (body?.promptFeedback?.blockReason) return { ok: false, reason: "blocked", ms: elapsed() };
    const text = (body?.candidates?.[0]?.content?.parts ?? [])
      .map((p) => (typeof p.text === "string" ? p.text : ""))
      .join("")
      .trim();
    if (!text) return { ok: false, reason: "no_text", ms: elapsed() };
    // models sometimes wrap JSON in a code fence even when asked not to
    const json = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try {
      return { ok: true, data: JSON.parse(json), ms: elapsed() };
    } catch {
      return { ok: false, reason: "not_json", ms: elapsed() };
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network_error", ms: elapsed() };
  }
}

/** One try, as it appears in a log line: the model, how it ended and how long it took. Never any content. */
export type GeminiAttempt = { model: string; outcome: string; ms: number };
export type GeminiOutcome = GeminiResult & { model: string; attempts: GeminiAttempt[] };

/** Outcomes that say "Google is busy or slow right now", which another model may well answer. A refusal or a bad key is not one. */
export function worthAnotherModel(r: GeminiResult): boolean {
  if (r.ok) return false;
  if (r.reason === "timeout" || r.reason === "network_error") return true;
  return r.reason === "http_error" && [500, 502, 503, 504].includes(r.status ?? 0);
}

const attemptOf = (model: string, r: GeminiResult): GeminiAttempt => ({
  model,
  outcome: r.ok ? "ok" : r.reason === "http_error" ? `http ${r.status ?? "?"}` : r.reason,
  ms: r.ms,
});

/**
 * Read the photo with `primary`; if Google was overloaded or too slow, try `fallback` once. With no fallback (or the same model)
 * this is exactly one call, as before. The photo is sent to Google twice only when the first try failed.
 */
export async function callGeminiWithFallback(
  key: string,
  models: { primary: string; fallback: string | null },
  imageBase64: string,
  mimeType: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GeminiOutcome> {
  const fallback = models.fallback && models.fallback !== models.primary ? models.fallback : null;
  const first = await callGemini(key, models.primary, imageBase64, mimeType, fetchImpl, fallback ? FIRST_TRY_MS : TIMEOUT_MS);
  if (!fallback || !worthAnotherModel(first)) return { ...first, model: models.primary, attempts: [attemptOf(models.primary, first)] };
  const second = await callGemini(key, fallback, imageBase64, mimeType, fetchImpl, SECOND_TRY_MS);
  return { ...second, model: fallback, attempts: [attemptOf(models.primary, first), attemptOf(fallback, second)] };
}
