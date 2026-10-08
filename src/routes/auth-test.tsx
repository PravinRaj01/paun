import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { API_BASE, GOOGLE_CLIENT_ID } from "@/lib/api";

/**
 * THROWAWAY spike page (PLAN.md phase 4b.2, removed in 4b.3 when the real sign-in lands in Settings). It proves the whole chain on real
 * infrastructure: Google's button -> an ID token -> our Worker checks it and opens a session -> we keep the bearer token and ask
 * "who am I". Nothing here is kept beyond this browser tab (sessionStorage), and nothing links to this page.
 */
export const Route = createFileRoute("/auth-test")({
  head: () => ({ meta: [{ title: "Sign-in test: Paun" }, { name: "robots", content: "noindex" }] }),
  component: AuthTest,
});

type GoogleId = {
  initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; use_fedcm_for_prompt?: boolean }) => void;
  renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
};
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}
const TOKEN_KEY = "gold-assistant:auth-test-token";

function AuthTest() {
  const button = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const log = (line: string) => setLines((l) => [...l, line]);

  const whoAmI = async (t: string) => {
    const res = await fetch(`${API_BASE}/me`, { headers: { authorization: `Bearer ${t}` } });
    log(`GET /me -> ${res.status} ${await res.text()}`);
  };

  const onCredential = async (credential: string) => {
    log("Google gave this page an ID token. Sending it to the Worker...");
    const res = await fetch(`${API_BASE}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "google", idToken: { token: credential } }),
    });
    const t = res.headers.get("set-auth-token");
    log(`POST /api/auth/sign-in/social -> ${res.status}; bearer token header present: ${t ? "yes" : "NO"}`);
    if (!res.ok || !t) return log((await res.text()).slice(0, 300));
    try {
      sessionStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* not kept across a refresh; fine for a test */
    }
    setToken(t);
    await whoAmI(t);
  };

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(TOKEN_KEY);
      if (saved) {
        setToken(saved);
        void whoAmI(saved);
      }
    } catch {
      /* ignore */
    }
    const start = () => {
      const g = window.google?.accounts.id;
      if (!g || !button.current) return;
      g.initialize({ client_id: GOOGLE_CLIENT_ID, callback: (r) => void onCredential(r.credential) });
      g.renderButton(button.current, { theme: "outline", size: "large", text: "signin_with" });
    };
    if (window.google) start();
    else {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = start;
      s.onerror = () => log("Could not load Google's sign-in script (blocked by an extension or the network?).");
      document.head.appendChild(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/api/auth/sign-out`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" });
    log(`POST /api/auth/sign-out -> ${res.status}`);
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    setToken(null);
    await whoAmI(token); // the old token must now be refused
  };

  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="font-display text-2xl">Sign-in test (temporary)</h1>
      <p className="text-sm text-muted-foreground">
        Proves Google sign-in, the Worker and the database work together. API: <span className="num">{API_BASE}</span>
      </p>
      <div ref={button} />
      {token && <Button variant="outline" onClick={signOut}>Sign out</Button>}
      <pre className="num whitespace-pre-wrap rounded-md border bg-card p-3 text-xs" aria-live="polite">{lines.length ? lines.join("\n") : "Nothing yet. Press the Google button."}</pre>
    </main>
  );
}
