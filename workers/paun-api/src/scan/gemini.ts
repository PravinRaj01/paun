import { PROMPT, RESPONSE_SCHEMA } from "./extract";

/**
 * One call to Google's Gemini (generateContent) with the photo and the extraction prompt. The key travels in a header, never in
 * the URL (URLs end up in logs). The photo is sent and forgotten: nothing here stores it, and nothing logs it or the reply.
 */
export type GeminiResult =
  | { ok: true; data: unknown; ms: number }
  | { ok: false; reason: "http_error" | "blocked" | "no_text" | "not_json" | "timeout" | "network_error"; status?: number; ms: number };

export const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const TIMEOUT_MS = 25_000;

export async function callGemini(
  key: string,
  model: string,
  imageBase64: string,
  mimeType: string,
  fetchImpl: typeof fetch = fetch,
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
