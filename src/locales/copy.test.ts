/**
 * The copy check (PLAN.md section 6, rule 8, and docs/glossary.md).
 *
 * Every word a shopper reads lives in en.json and ms.json. This test fails when the two files drift apart, when a key is
 * unused, when a core screen string is too long, when a word from the glossary's "Avoid" list comes back, or when a
 * component writes text of its own.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import en from "./en.json";
import ms from "./ms.json";

const ROOT = process.cwd();
const EN = en as Record<string, string>;
const MS = ms as Record<string, string>;
const keys = Object.keys(EN);

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const stripPlaceholders = (s: string) => s.replace(/\{\{\s*\w+\s*\}\}/g, "");
const placeholders = (s: string) => (s.match(/\{\{\s*\w+\s*\}\}/g) ?? []).map((p) => p.replace(/\s/g, "")).sort().join(",");

function walk(dir: string, accept: (path: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "locales") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, accept, out);
    else if (accept(p)) out.push(p);
  }
  return out;
}
const rel = (p: string) => relative(ROOT, p).split(sep).join("/");
const read = (p: string) => readFileSync(p, "utf8");

const sourceFiles = walk(join(ROOT, "src"), (p) => /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p) && !/routeTree\.gen/.test(p));
const sourceText = sourceFiles.map(read).join("\n");
const quoted = new Set([...sourceText.matchAll(/["'`]([A-Za-z][A-Za-z0-9]*)["'`]/g)].map((m) => m[1]!));

describe("the two languages agree", () => {
  it("have the same keys", () => {
    const missingInMs = keys.filter((k) => !(k in MS));
    const extraInMs = Object.keys(MS).filter((k) => !(k in EN));
    expect({ missingInMs, extraInMs }).toEqual({ missingInMs: [], extraInMs: [] });
  });

  it("use the same {{placeholders}} in every string", () => {
    expect(keys.filter((k) => k in MS && placeholders(EN[k]!) !== placeholders(MS[k]!))).toEqual([]);
  });

  it("have no empty strings", () => {
    expect(keys.filter((k) => !EN[k]?.trim() || !MS[k]?.trim())).toEqual([]);
  });
});

describe("no key is left over", () => {
  it("every key is used by some component, route or library file", () => {
    expect(keys.filter((k) => !quoted.has(k))).toEqual([]);
  });
});

/** Words from docs/glossary.md's "Avoid" columns. Placeholder names are removed before matching. */
const AVOID_EN: [RegExp, string][] = [
  [/making fee/i, "say upah (making charge)"],
  [/workmanship/i, "say upah (making charge)"],
  [/\bpremium\b/i, "say shop mark-up"],
  [/\bmarkup\b/i, "write mark-up"],
  [/\bspot\b/i, "say gold price or raw gold"],
  [/arbitrage/i, "say compare countries"],
  [/\bspread\b/i, "say gap"],
  [/break-?even/i, "not used"],
  [/\bfair price\b|\btrue price\b/i, "Paun never calls a price fair"],
];
const AVOID_MS: [RegExp, string][] = [
  [/susut nilai/i, "say susut (susut nilai means depreciation)"],
  [/\bmargin\b/i, "say tokokan kedai"],
  [/\bpremium\b/i, "say tokokan kedai"],
  [/upah tukang/i, "say upah"],
  [/\bspot\b/i, "say harga emas"],
  [/harga mentah|harga spot/i, "say emas mentah or harga emas dunia"],
  [/kadar beli(?! balik)\b/i, "say kadar beli balik"],
];

describe("the glossary (docs/glossary.md)", () => {
  it("English avoids the words on its list", () => {
    const hits = keys.flatMap((k) => AVOID_EN.filter(([re]) => re.test(stripPlaceholders(EN[k]!))).map(([, why]) => `${k}: ${why}`));
    expect(hits).toEqual([]);
  });
  it("Malay avoids the words on its list", () => {
    const hits = keys.flatMap((k) => AVOID_MS.filter(([re]) => re.test(stripPlaceholders(MS[k] ?? ""))).map(([, why]) => `${k}: ${why}`));
    expect(hits).toEqual([]);
  });
});

/** The screens a shopper meets first. A key used by any of these files must stay short. */
const CORE_FILES = [
  "src/components/gold/BuyCheck.tsx",
  "src/components/gold/SellCheck.tsx",
  "src/components/gold/CompareQuotes.tsx",
  "src/components/gold/TradeAnalyzer.tsx",
  "src/components/gold/check-ui.tsx",
  "src/components/gold/SpotBar.tsx",
  "src/components/gold/SideDock.tsx",
  "src/components/gold/dock-registry.ts",
  "src/routes/dashboard.tsx",
  "src/routes/vault.tsx",
  "src/routes/index.tsx",
  "src/routes/more.tsx",
];
const MAX_EN = 20;
const MAX_MS = 26; // Malay runs about a quarter longer for the same sentence

describe("core screens stay short", () => {
  const used = new Set<string>();
  for (const f of CORE_FILES) {
    const text = read(join(ROOT, f));
    for (const m of text.matchAll(/["'`]([A-Za-z][A-Za-z0-9]*)["'`]/g)) if (m[1]! in EN) used.add(m[1]!);
  }
  it("lists real files", () => {
    for (const f of CORE_FILES) expect(() => statSync(join(ROOT, f)), f).not.toThrow();
  });
  it(`English strings are at most ${MAX_EN} words`, () => {
    expect([...used].filter((k) => words(stripPlaceholders(EN[k]!)) > MAX_EN).map((k) => `${k} (${words(EN[k]!)})`)).toEqual([]);
  });
  it(`Malay strings are at most ${MAX_MS} words`, () => {
    expect([...used].filter((k) => words(stripPlaceholders(MS[k]!)) > MAX_MS).map((k) => `${k} (${words(MS[k]!)})`)).toEqual([]);
  });
});

/** Text that is not a sentence: brand and language names, and example formats. */
const ALLOWED_LITERALS = new Set(["Paun", "English", "Bahasa Melayu", "Gemini", "GoldAPI", "Google", "AIza…", "goldapi-xxxx", "MYR", "USD"]);

describe("components carry no text of their own", () => {
  const files = walk(join(ROOT, "src"), (p) => /\.tsx$/.test(p) && !/\.test\./.test(p) && !/routeTree\.gen/.test(p) && !/[\\/]components[\\/]ui[\\/]/.test(p));

  it("never pick a language by hand", () => {
    // gold-store sets <html lang>, which is an attribute and not text a shopper reads
    const hits = files.filter((f) => !f.endsWith("gold-store.tsx") && /language\s*===\s*["']ms["']|\bms\s*\?\s*["'`]/.test(read(f))).map(rel);
    expect(hits).toEqual([]);
  });

  it("have no English in JSX text, titles, placeholders or aria-labels", () => {
    const hits: string[] = [];
    for (const f of files) {
      const lines = read(f).split(/\r?\n/);
      lines.forEach((line, i) => {
        const s = line.trim();
        if (/^(\/\/|\*|\/\*|import |export type )/.test(s)) return;
        const found: string[] = [];
        for (const m of s.matchAll(/<\/?[A-Za-z][^<>]*>([^<>{}]+)</g)) found.push(m[1]!.trim());
        for (const m of s.matchAll(/\b(?:title|placeholder|aria-label|alt|label|description)="([^"{}]+)"/g)) found.push(m[1]!.trim());
        // a line of plain words inside a multi-line JSX element
        if (/^[A-Z][A-Za-z'’.,&/-]*( [A-Za-z'’.,&/()%-]+){2,}[.?!:]?$/.test(s) && !/[;=]/.test(s)) found.push(s);
        for (const text of found) {
          if (!/[A-Za-z]{3,}/.test(text) || ALLOWED_LITERALS.has(text)) continue;
          if (/===|=>|&&|\|\||\s\?\s|\s:\s/.test(text)) continue; // code between two elements, not text
          if (/^[a-z-]+(\s+[a-z-]+)*$/.test(text) && !/[A-Z]/.test(text) && words(text) === 1) continue; // class-like single token
          hits.push(`${rel(f)}:${i + 1}: ${text.slice(0, 70)}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it("have no literal text in toasts", () => {
    const hits = files.flatMap((f) => read(f).split(/\r?\n/).map((l, i) => [f, i, l] as const)).filter(([, , l]) => /\btoast(\.\w+)?\(\s*["'`][A-Za-z]/.test(l)).map(([f, i]) => `${rel(f)}:${i + 1}`);
    expect(hits).toEqual([]);
  });
});
