/**
 * Cloudflare Turnstile: proves a real browser (not a script) asked for this scan. The widget in the page produces a one-time token;
 * we check it with Cloudflare using our secret before spending anything on the AI.
 */
export type TurnstileResult = { ok: true } | { ok: false; reason: "rejected" | "unavailable" };

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(
  secret: string,
  token: string,
  ip: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set("remoteip", ip);
  try {
    const res = await fetchImpl(VERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const body = (await res.json().catch(() => null)) as { success?: unknown } | null;
    return body?.success === true ? { ok: true } : { ok: false, reason: "rejected" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
