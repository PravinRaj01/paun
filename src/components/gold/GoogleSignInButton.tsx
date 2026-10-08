import { useEffect, useRef } from "react";
import { GOOGLE_CLIENT_ID } from "@/lib/api";

/**
 * Google's own "Sign in with Google" button (Google Identity Services). Google hands back a signed ID token, which the page trades for a
 * session at our Worker. The script is loaded only when this component is shown, so no other page pays for it.
 */
type GoogleId = {
  initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
  renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
};
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

const SCRIPT = "https://accounts.google.com/gsi/client";
let loading: Promise<GoogleId> | null = null;
function loadGoogle(): Promise<GoogleId> {
  loading ??= new Promise<GoogleId>((resolve, reject) => {
    if (window.google) return resolve(window.google.accounts.id);
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.google ? resolve(window.google.accounts.id) : reject(new Error("google missing")));
    s.onerror = () => reject(new Error("google failed to load"));
    document.head.appendChild(s);
  }).catch((e) => {
    loading = null; // allow a later retry
    throw e;
  });
  return loading;
}

export function GoogleSignInButton({
  onCredential,
  onUnavailable,
  language,
}: {
  onCredential: (idToken: string) => void;
  /** The script could not load (blocked by an extension or the network). */
  onUnavailable: () => void;
  language: "en" | "ms";
}) {
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;
  const fail = useRef(onUnavailable);
  fail.current = onUnavailable;
  useEffect(() => {
    let alive = true;
    loadGoogle().then(
      (g) => {
        if (!alive || !box.current) return;
        g.initialize({ client_id: GOOGLE_CLIENT_ID, callback: (r) => cb.current(r.credential) });
        g.renderButton(box.current, { theme: "outline", size: "large", text: "signin_with", shape: "rectangular", locale: language, width: 280 });
      },
      () => fail.current(),
    );
    return () => {
      alive = false;
    };
  }, [language]);
  return <div ref={box} className="min-h-[44px]" data-testid="google-signin" />;
}
