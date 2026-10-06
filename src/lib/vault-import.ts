import { LEGACY_PURITY, PURITIES, type PurityId, type VaultItem } from "./gold";

/**
 * Strict validation for a Vault JSON file (the format the Export button writes).
 *
 * Why this exists: the old importer accepted any JSON array, silently ignored errors, REPLACED the whole vault, and kept
 * whatever purity text it found. A file with a typo could wipe a user's holdings and leave nonsense behind. This one:
 *   - reports a broken file instead of swallowing it,
 *   - keeps only well-formed items and counts the rest by reason,
 *   - never invents data (an unknown purity is skipped, not turned into 916),
 *   - never drops an id collision silently, and
 *   - returns only the NEW items, so the caller can merge them into the existing vault.
 */
export type SkipReason = "notItem" | "weight" | "purity" | "paid" | "date" | "duplicate";

export type VaultImportResult =
  | { ok: false; error: "invalidJson" | "notArray" }
  | {
      ok: true;
      items: VaultItem[];
      imported: number;
      skipped: Partial<Record<SkipReason, number>>;
      skippedTotal: number;
    };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in YYYY-MM-DD form (rejects 2026-02-31, which Date would roll over to March). */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** A known fineness stamp ("916") or an old karat label ("22K", any case); anything else is undefined. */
export function parsePurity(v: unknown): PurityId | undefined {
  const raw = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (PURITIES.some((p) => p.id === raw)) return raw as PurityId;
  return LEGACY_PURITY[raw.toUpperCase()];
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function parseVaultImport(
  text: string,
  existing: readonly VaultItem[],
  newId: () => string = () => crypto.randomUUID(),
): VaultImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "invalidJson" };
  }
  if (!Array.isArray(data)) return { ok: false, error: "notArray" };

  const takenIds = new Set(existing.map((x) => x.id));
  const items: VaultItem[] = [];
  const skipped: Partial<Record<SkipReason, number>> = {};
  const skip = (r: SkipReason) => {
    skipped[r] = (skipped[r] ?? 0) + 1;
  };

  for (const raw of data as unknown[]) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      skip("notItem");
      continue;
    }
    const o = raw as Record<string, unknown>;
    if (!isFiniteNumber(o["weight"]) || o["weight"] <= 0) {
      skip("weight");
      continue;
    }
    const purity = parsePurity(o["purity"]);
    if (!purity) {
      skip("purity");
      continue;
    }
    if (!isFiniteNumber(o["paidUsd"]) || o["paidUsd"] < 0) {
      skip("paid");
      continue;
    }
    if (!isIsoDate(o["date"])) {
      skip("date");
      continue;
    }
    let id: string;
    if (typeof o["id"] === "string" && o["id"].trim() !== "") {
      id = o["id"];
      if (takenIds.has(id)) {
        skip("duplicate");
        continue;
      }
    } else {
      id = newId();
    }
    takenIds.add(id);
    const name =
      typeof o["name"] === "string" && o["name"].trim() !== ""
        ? o["name"].trim().slice(0, 80)
        : `${o["weight"]} g ${purity}`;
    items.push({ id, name, weight: o["weight"], purity, paidUsd: o["paidUsd"], date: o["date"] });
  }

  const skippedTotal = Object.values(skipped).reduce((a, b) => a + (b ?? 0), 0);
  return { ok: true, items, imported: items.length, skipped, skippedTotal };
}
