import { useEffect, useRef } from "react";
import { TURNSTILE_SITE_KEY } from "@/lib/scan";

/**
 * Cloudflare Turnstile ("are you a person?"), loaded only when the scanner dialog opens so no other page pays for it. Managed mode:
 * usually invisible and automatic. `onToken(null)` means the token expired or the check failed. A token works once, so the parent
 * gives this component a new `key` to get a fresh widget (and a fresh token) after each attempt.
 */
type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    s.onerror = () => reject(new Error("turnstile failed to load"));
    document.head.appendChild(s);
  }).catch((e) => {
    loading = null; // allow a later retry
    throw e;
  });
  return loading;
}

export function Turnstile({
  onToken,
  onError,
  language,
}: {
  onToken: (token: string | null) => void;
  /** The check could not run or failed (blocked script, network). The user can try again. */
  onError: () => void;
  language: "en" | "ms";
}) {
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  cb.current = onToken;
  const err = useRef(onError);
  err.current = onError;
  useEffect(() => {
    let id: string | null = null;
    let api: TurnstileApi | null = null;
    let alive = true;
    loadTurnstile().then(
      (t) => {
        if (!alive || !box.current) return;
        api = t;
        id = t.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          language,
          theme: "auto",
          callback: (token: string) => cb.current(token),
          "expired-callback": () => cb.current(null),
          "error-callback": () => err.current(),
        });
      },
      () => err.current(),
    );
    return () => {
      alive = false;
      if (api && id) api.remove(id);
    };
  }, [language]);
  return <div ref={box} className="min-h-[65px]" data-testid="turnstile" />;
}
