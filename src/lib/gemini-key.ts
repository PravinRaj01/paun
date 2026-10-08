/**
 * The visitor's OWN Gemini key for the receipt scanner (PLAN.md 4.6c). It lives only in this browser and Paun never keeps it:
 * it is sent with each scan through our Worker to reach Google, and nowhere else.
 *
 * The visitor chooses how long it is kept:
 *   "device"  LocalStorage: stays on this browser until they clear it
 *   "session" sessionStorage: forgotten when the browser (or tab) closes; a good choice on a shared computer
 * It is deliberately NOT part of `Settings`, so it can never end up in an export or a backup. Every access is wrapped because
 * storage can be blocked (private windows, strict settings); then the key simply is not remembered.
 */
const NAME = "gold-assistant:gemini-key";
export type GeminiKeyMode = "device" | "session";

/** Same shape the Worker accepts: about 39 characters of letters, digits, - and _ . */
export const isPlausibleGeminiKey = (key: string) => /^[A-Za-z0-9_-]{20,200}$/.test(key.trim());

const store = (mode: GeminiKeyMode): Storage | null => {
  try {
    return mode === "device" ? globalThis.localStorage : globalThis.sessionStorage;
  } catch {
    return null;
  }
};
const read = (mode: GeminiKeyMode): string | null => {
  try {
    return store(mode)?.getItem(NAME) ?? null;
  } catch {
    return null;
  }
};

/** The saved key and where it is kept, or null when there is none. (A session key wins if both somehow exist.) */
export function readGeminiKey(): { key: string; mode: GeminiKeyMode } | null {
  for (const mode of ["session", "device"] as const) {
    const key = read(mode)?.trim();
    if (key) return { key, mode };
  }
  return null;
}
export const getGeminiKey = () => readGeminiKey()?.key ?? null;

export function clearGeminiKey(): void {
  for (const mode of ["device", "session"] as const) {
    try {
      store(mode)?.removeItem(NAME);
    } catch {
      /* nothing more to do */
    }
  }
}

/** Save (or, for an empty key, remove) the key. Always clears the other place first. Returns false if the browser refused to store it. */
export function setGeminiKey(key: string, mode: GeminiKeyMode): boolean {
  clearGeminiKey();
  const k = key.trim();
  if (!k) return true;
  try {
    const s = store(mode);
    if (!s) return false;
    s.setItem(NAME, k);
    return true;
  } catch {
    return false;
  }
}
