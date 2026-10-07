import type { Env, KvLike } from "./env";

/** A KV namespace in memory, for tests. Counts its writes so a test can prove "nothing was written". */
export function fakeKv(initial: Record<string, string> = {}): KvLike & { data: Map<string, string>; puts: number } {
  const data = new Map(Object.entries(initial));
  const kv = {
    data,
    puts: 0,
    get: async (k: string) => data.get(k) ?? null,
    put: async (k: string, v: string) => {
      kv.puts++;
      data.set(k, v);
    },
  };
  return kv;
}

export const testEnv = (over: Partial<Env> = {}): Env & { SPOT: ReturnType<typeof fakeKv> } => ({ SPOT: fakeKv(), ...over }) as never;

/** A Yahoo chart reply for a given price (market time 2026-10-07 16:03:25 UTC). */
export const yahooReply = (price: number) =>
  new Response(
    JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: price, regularMarketTime: 1791389005, symbol: "GC=F", currency: "USD" } }] } }),
  );

/**
 * A fake `fetch` that answers by host and records every call: each route is a Response factory or an Error to throw.
 * Anything else fails the test, so an unexpected request (say, to a provider on a read route) cannot go unnoticed.
 */
type Route = () => Response | Error;
export function fakeFetch(routes: { yahoo?: Route; goldapi?: Route; turnstile?: Route; gemini?: Route }) {
  const calls: { host: string; url: string; headers: Headers; body: string }[] = [];
  const impl = (async (input: string, init?: RequestInit) => {
    const url = String(input);
    const host = new URL(url).host;
    calls.push({ host, url, headers: new Headers(init?.headers), body: init?.body ? String(init.body) : "" });
    const route = host.includes("yahoo")
      ? routes.yahoo
      : host.includes("goldapi")
        ? routes.goldapi
        : host.includes("challenges.cloudflare")
          ? routes.turnstile
          : host.includes("generativelanguage")
            ? routes.gemini
            : undefined;
    if (!route) throw new Error(`unexpected request to ${host}`);
    const out = route();
    if (out instanceof Error) throw out;
    return out;
  }) as unknown as typeof fetch;
  return { impl, calls, count: (needle: string) => calls.filter((c) => c.host.includes(needle)).length };
}
