/** What the Worker is given by Cloudflare: bindings, secrets and plain variables (see wrangler.jsonc). */

/** The slice of a KV namespace we use; the real `KVNamespace` fits it, and tests use a Map. */
export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export type Env = {
  /** KV namespace holding the latest shared price and the GoldAPI call counters. */
  SPOT: KvLike;
  /** Secret (`wrangler secret put GOLDAPI_KEY`). Absent = no backup source; never logged, never returned. */
  GOLDAPI_KEY?: string;
  /** Hard cap on GoldAPI calls per calendar month (UTC). The owner's plan allows 100; we stop at 90. */
  MONTHLY_BUDGET?: string;
  /** Hard cap on GoldAPI calls per day (UTC), so a long Yahoo outage cannot spend the month in a few days. */
  DAILY_BUDGET?: string;
  /** Comma-separated extra origins allowed to call us from a browser, e.g. a custom domain added later. */
  EXTRA_ORIGINS?: string;
};

export type ScheduledEventLike = { cron: string; scheduledTime: number };
export type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };
