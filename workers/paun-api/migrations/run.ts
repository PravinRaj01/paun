/**
 * Applies the SQL files in this folder to the Neon database, in name order, once each. Run from the repo root:
 *
 *   bun workers/paun-api/migrations/run.ts
 *
 * The database address comes from the DATABASE_URL environment variable, or from workers/paun-api/.dev.vars (git-ignored).
 * It is never printed. Which files have run is recorded in a `_migrations` table, so running it again is safe.
 * Each file runs inside one transaction: it either applies completely or not at all.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Pool } from "@neondatabase/serverless";

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

async function main() {
  const dir = resolve("workers/paun-api/migrations");
  const files = readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const pool = new Pool({ connectionString: databaseUrl() });
  try {
    await pool.query("create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())");
    const done = new Set((await pool.query<{ name: string }>("select name from _migrations")).rows.map((r) => r.name));
    let ran = 0;
    for (const f of files) {
      if (done.has(f)) {
        console.log(`  skip   ${f} (already applied)`);
        continue;
      }
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(readFileSync(join(dir, f), "utf8"));
        await client.query("insert into _migrations (name) values ($1)", [f]);
        await client.query("commit");
        console.log(`  applied ${f}`);
        ran++;
      } catch (e) {
        await client.query("rollback").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    }
    console.log(`done: ${ran} applied, ${files.length - ran} already there`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  // only the message: the error can carry the connection details, so never dump the whole object
  console.error(`migration failed: ${e instanceof Error ? e.message.replace(/postgres(ql)?:\/\/\S+/g, "postgresql://[hidden]") : "unknown error"}`);
  process.exit(1);
});
