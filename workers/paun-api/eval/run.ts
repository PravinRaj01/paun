/**
 * Real-photo evaluation of the receipt scanner (PLAN.md, phase 4.4). Run it with Bun from the repo root:
 *
 *   bun workers/paun-api/eval/run.ts                  # photos and answers in ./receipts-ref
 *   bun workers/paun-api/eval/run.ts path/to/folder   # another folder
 *
 * It runs the SAME pipeline as POST /scan (the same prompt, the same Gemini call, the same sanitiser) on every photo in the folder
 * and scores each field against `expected.json` in that folder. It costs real (tiny) Gemini calls and needs GEMINI_API_KEY in
 * workers/paun-api/.dev.vars (git-ignored). The key is never printed. Photos and answers stay in a git-ignored folder: receipts
 * hold real people's details and must never be committed.
 *
 * expected.json:  { "photo.jpg": { "purity": "916", "weightGrams": 12.5, "makingFee": null, "purchaseDate": "2026-01-31",
 *                                  "totalPaid": 6120.5, "currency": "MYR" } }
 *   null = the receipt does not show it (the right answer is null);  "ignore" = ambiguous in the photo, not scored.
 *   makingFee, when set, is { "amount": 8, "per": "gram" }.
 *
 * How a field is scored:
 *   correct   same as expected (numbers within 0.01)
 *   missed    the scanner said null but the receipt shows a value: the user types it in, a small cost
 *   WRONG     the scanner gave a value that is not the expected one (including a value where the receipt shows none): the costly kind
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { callGemini, DEFAULT_MODEL } from "../src/scan/gemini";
import { sanitizeScan, type ScanFields } from "../src/scan/extract";

const FIELDS = ["purity", "weightGrams", "makingFee", "purchaseDate", "totalPaid", "currency"] as const;
type Field = (typeof FIELDS)[number];
type Verdict = "correct" | "missed" | "WRONG" | "ignored";

const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

function readVars(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
  return out;
}

const same = (a: unknown, b: unknown) =>
  typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 0.01 : JSON.stringify(a) === JSON.stringify(b);

function score(got: unknown, want: unknown): Verdict {
  if (want === "ignore") return "ignored";
  if (same(got, want)) return "correct";
  return got === null ? "missed" : "WRONG";
}

const show = (v: unknown) => (v === null ? "null" : typeof v === "object" ? JSON.stringify(v) : String(v));

async function main() {
  const dir = resolve(process.argv[2] ?? "receipts-ref");
  const vars = readVars(resolve("workers/paun-api/.dev.vars"));
  const key = vars["GEMINI_API_KEY"];
  if (!key) throw new Error("GEMINI_API_KEY is missing from workers/paun-api/.dev.vars");
  const model = vars["GEMINI_MODEL"] || DEFAULT_MODEL;
  const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as Record<string, Partial<Record<Field, unknown>>>;
  const photos = readdirSync(dir).filter((f) => MIME[extname(f).toLowerCase()]).sort();
  console.log(`Model ${model}, ${photos.length} photos in ${dir}\n`);

  const tally: Record<Field, Record<Verdict, number>> = Object.fromEntries(
    FIELDS.map((f) => [f, { correct: 0, missed: 0, WRONG: 0, ignored: 0 }]),
  ) as never;
  let failures = 0;

  for (const name of photos) {
    const bytes = readFileSync(join(dir, name));
    const mime = MIME[extname(name).toLowerCase()]!;
    const res = await callGemini(key, model, bytes.toString("base64"), mime);
    if (!res.ok) {
      failures++;
      console.log(`${name}: Gemini call failed (${res.reason}${res.status ? ` ${res.status}` : ""}, ${res.ms} ms)\n`);
      continue;
    }
    const scan = sanitizeScan(res.data, new Date());
    console.log(`${name}  (${res.ms} ms, readable=${scan.readable}, confidence=${scan.confidence}, item: ${show(scan.fields.itemName)})`);
    const want = expected[name];
    if (!want) console.log("  (no expected answers for this photo; fields shown, not scored)");
    for (const f of FIELDS) {
      const got = (scan.fields as ScanFields)[f];
      if (!want || !(f in want)) {
        console.log(`  ${f.padEnd(13)} ${show(got)}`);
        continue;
      }
      const verdict = score(got, want[f]);
      tally[f][verdict]++;
      console.log(`  ${f.padEnd(13)} ${verdict.padEnd(8)} got ${show(got)}   expected ${show(want[f])}`);
    }
    console.log("");
  }

  console.log("Summary (per field, over the photos that have expected answers)");
  console.log("  field          correct  missed  WRONG  ignored");
  let c = 0, m = 0, w = 0;
  for (const f of FIELDS) {
    const t = tally[f];
    c += t.correct; m += t.missed; w += t.WRONG;
    console.log(`  ${f.padEnd(13)} ${String(t.correct).padStart(7)} ${String(t.missed).padStart(7)} ${String(t.WRONG).padStart(6)} ${String(t.ignored).padStart(8)}`);
  }
  const scored = c + m + w;
  console.log(`\n  Scored fields: ${scored}.  correct ${c} (${scored ? Math.round((100 * c) / scored) : 0}%), missed ${m}, WRONG ${w}.`);
  if (failures) console.log(`  ${failures} photo(s) failed to scan at all.`);
}

main().catch((e) => {
  // never print anything that could contain the key: only the message
  console.error(`eval failed: ${e instanceof Error ? e.message : "unknown error"}`);
  process.exit(1);
});
