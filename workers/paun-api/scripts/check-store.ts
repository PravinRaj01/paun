/**
 * Runs the Vault store rules (`src/vault/scenarios.ts`, the same ones the unit tests run against the in-memory store) against the
 * REAL Neon database, so the two implementations are held to exactly the same behaviour. Run from the repo root:
 *
 *   bun run check:store
 *
 * What it does to the database: it creates two throwaway accounts (ids `chk-...`, e-mail `...@example.invalid`), runs every scenario
 * for them, and deletes them again in a `finally` block. Deleting an account cascades to its pieces and settings, so nothing is left.
 * It never touches a real account. Apply the migrations first (`bun workers/paun-api/migrations/run.ts`).
 *
 * The database address comes from DATABASE_URL (environment) or workers/paun-api/.dev.vars (git-ignored), and is never printed.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "@neondatabase/serverless";
import { scenarios } from "../src/vault/scenarios";
import { PgVaultStore } from "../src/vault/store";

function databaseUrl(): string {
  if (process.env["DATABASE_URL"]) return process.env["DATABASE_URL"];
  const vars = resolve("workers/paun-api/.dev.vars");
  if (existsSync(vars)) {
    for (const line of readFileSync(vars, "utf8").split(/\r?\n/)) {
      const m = /^\s*DATABASE_URL\s*=\s*(.*?)\s*$/.exec(line);
      if (m?.[1]) return m[1].replace(/^["']|["']$/g, "");
    }
  }
  throw new Error("DATABASE_URL is not set (environment or workers/paun-api/.dev.vars)");
}

const clean = (e: unknown) => (e instanceof Error ? e.message.replace(/postgres(ql)?:\/\/\S+/g, "postgresql://[hidden]") : "unknown error");

async function main() {
  const pool = new Pool({ connectionString: databaseUrl() });
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const ids = [`chk-${stamp}-a`, `chk-${stamp}-b`];
  let failed = 0;
  try {
    // the migration this check needs: say so plainly instead of failing inside a scenario
    try {
      await pool.query("select paid, currency from vault_items limit 0");
    } catch {
      throw new Error("vault_items has no paid / currency columns yet: run `bun workers/paun-api/migrations/run.ts` first (migration 004)");
    }
    for (const id of ids) {
      await pool.query(`insert into "user" ("id", "name", "email", "emailVerified") values ($1, 'store check', $2, false)`, [id, `${id}@example.invalid`]);
    }
    const store = new PgVaultStore(pool);
    for (const s of scenarios) {
      // every scenario starts from a clean slate for the two throwaway accounts
      await pool.query("delete from vault_items where user_id = any($1)", [ids]);
      await pool.query("delete from user_prefs where user_id = any($1)", [ids]);
      try {
        await s.run(store, ids[0]!, ids[1]!);
        console.log(`  ok    ${s.name}`);
      } catch (e) {
        failed++;
        console.log(`  FAIL  ${s.name}\n        ${clean(e)}`);
      }
    }
    console.log(failed === 0 ? `\nall ${scenarios.length} scenarios pass against Postgres` : `\n${failed} of ${scenarios.length} scenarios FAILED`);
  } finally {
    await pool.query(`delete from "user" where "id" = any($1)`, [ids]).catch(() => undefined);
    const left = await pool.query(`select count(*)::int as n from "user" where "id" = any($1)`, [ids]).catch(() => null);
    if (left && (left.rows[0] as { n: number } | undefined)?.n) console.log("WARNING: a throwaway account was not removed; delete ids starting with chk- by hand");
    await pool.end().catch(() => undefined);
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(`check failed: ${clean(e)}`);
  process.exit(1);
});
