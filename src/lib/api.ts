/** Where the `paun-api` Worker lives, and the public Google client id the sign-in button uses. Both are public by design. */
export const API_BASE = (import.meta.env["VITE_PAUN_API"] as string | undefined) ?? "https://paun-api.paun-gold.workers.dev";
/** Identifies Paun to Google; the matching secret lives only in the Worker. (Same value as GOOGLE_CLIENT_ID in workers/paun-api/wrangler.jsonc.) */
export const GOOGLE_CLIENT_ID = (import.meta.env["VITE_GOOGLE_CLIENT_ID"] as string | undefined) ?? "745030658975-4nlu1tjvdqb9ga7u0oralmf2mpqskchc.apps.googleusercontent.com";
