import { describe, expect, it } from "vitest";
import type { VaultItem } from "./gold";
import { isIsoDate, parsePurity, parseVaultImport } from "./vault-import";

const good = {
  id: "a1",
  name: "Ring",
  weight: 10,
  purity: "916",
  paidUsd: 800,
  date: "2026-03-15",
};
const run = (data: unknown, existing: VaultItem[] = []) => {
  let n = 0;
  return parseVaultImport(
    typeof data === "string" ? data : JSON.stringify(data),
    existing,
    () => `gen-${++n}`,
  );
};

describe("file-level errors", () => {
  it("reports a file that is not valid JSON", () => {
    expect(run("{ not json")).toEqual({ ok: false, error: "invalidJson" });
    expect(run("")).toEqual({ ok: false, error: "invalidJson" });
  });

  it("reports JSON that is not a list", () => {
    expect(run({ items: [good] })).toEqual({ ok: false, error: "notArray" });
    expect(run('"hello"')).toEqual({ ok: false, error: "notArray" });
    expect(run("null")).toEqual({ ok: false, error: "notArray" });
  });

  it("an empty list is fine and imports nothing", () => {
    expect(run([])).toMatchObject({ ok: true, imported: 0, skippedTotal: 0, items: [] });
  });
});

describe("a well-formed item", () => {
  it("is imported with exactly the fields the Vault uses (extra properties are dropped)", () => {
    const r = run([{ ...good, evil: "<script>", extra: 1 }]);
    expect(r).toMatchObject({ ok: true, imported: 1, skippedTotal: 0 });
    if (r.ok)
      expect(r.items[0]).toEqual({
        id: "a1",
        name: "Ring",
        weight: 10,
        purity: "916",
        paidUsd: 800,
        date: "2026-03-15",
      });
  });

  it("round-trips: what Export writes, Import reads back unchanged", () => {
    const vault: VaultItem[] = [
      {
        id: "x",
        name: "Bar",
        weight: 31.1035,
        purity: "999.9",
        paidUsd: 2100.5,
        date: "2025-01-02",
      },
      { id: "y", name: "Chain", weight: 5.25, purity: "750", paidUsd: 0, date: "2024-12-31" },
    ];
    const r = run(JSON.stringify(vault, null, 2));
    expect(r.ok && r.items).toEqual(vault);
  });

  it("gives an unnamed item a readable default name and trims or caps long names", () => {
    const r = run([
      { ...good, id: "n1", name: "" },
      { ...good, id: "n2", name: "  Spaced  " },
      { ...good, id: "n3", name: "x".repeat(200) },
    ]);
    if (!r.ok) throw new Error("expected ok");
    expect(r.items.map((i) => i.name)).toEqual(["10 g 916", "Spaced", "x".repeat(80)]);
  });

  it("generates an id when the file has none, and keeps them unique", () => {
    const r = run([
      { ...good, id: undefined },
      { ...good, id: undefined },
    ]);
    if (!r.ok) throw new Error("expected ok");
    expect(r.items.map((i) => i.id)).toEqual(["gen-1", "gen-2"]);
  });
});

describe("purity", () => {
  it("accepts known stamps, legacy karat labels in any case, and numeric stamps", () => {
    expect(parsePurity("916")).toBe("916");
    expect(parsePurity("999.9")).toBe("999.9");
    expect(parsePurity(" 750 ")).toBe("750");
    expect(parsePurity("22K")).toBe("916");
    expect(parsePurity("22k")).toBe("916");
    expect(parsePurity("24K")).toBe("999.9");
    expect(parsePurity(916)).toBe("916");
    expect(parsePurity(999.9)).toBe("999.9");
  });

  it("rejects unknown purity instead of guessing 916 (the old importer's silent corruption)", () => {
    for (const bad of ["banana", "", "917", "22 carat", null, undefined, {}, []])
      expect(parsePurity(bad)).toBeUndefined();
    const r = run([
      { ...good, purity: "banana" },
      { ...good, id: "b", purity: "22K" },
    ]);
    expect(r).toMatchObject({ ok: true, imported: 1, skipped: { purity: 1 } });
    if (r.ok) expect(r.items[0]?.purity).toBe("916"); // the legacy label, mapped on purpose
  });
});

describe("skipped items are counted by reason, never silently dropped", () => {
  it("weight must be a positive finite number", () => {
    const r = run(
      [0, -1, "10", null, Number.NaN].map((w, i) => ({ ...good, id: `w${i}`, weight: w })),
    );
    expect(r).toMatchObject({ ok: true, imported: 0, skipped: { weight: 5 }, skippedTotal: 5 });
  });

  it("amount paid must be a finite number, zero or more", () => {
    const r = run([
      { ...good, id: "p1", paidUsd: -5 },
      { ...good, id: "p2", paidUsd: "800" },
      { ...good, id: "p3", paidUsd: undefined },
      { ...good, id: "p4", paidUsd: 0 },
    ]);
    expect(r).toMatchObject({ imported: 1, skipped: { paid: 3 } });
  });

  it("date must be a real YYYY-MM-DD calendar date", () => {
    const dates = ["2026-02-31", "2026-2-3", "yesterday", "2026/03/15", "", 20260315, null];
    const r = run(dates.map((d, i) => ({ ...good, id: `d${i}`, date: d })));
    expect(r).toMatchObject({ ok: true, imported: 0, skipped: { date: dates.length } });
    expect(isIsoDate("2024-02-29")).toBe(true); // leap day
    expect(isIsoDate("2025-02-29")).toBe(false);
  });

  it("entries that are not objects are skipped as 'notItem'", () => {
    expect(run([null, 5, "x", [1, 2], good])).toMatchObject({
      imported: 1,
      skipped: { notItem: 4 },
      skippedTotal: 4,
    });
  });

  it("reports a mixed file accurately (the '4 imported, 1 skipped: invalid purity' case)", () => {
    const r = run([
      { ...good, id: "1" },
      { ...good, id: "2" },
      { ...good, id: "3" },
      { ...good, id: "4" },
      { ...good, id: "5", purity: "zzz" },
    ]);
    expect(r).toMatchObject({ ok: true, imported: 4, skipped: { purity: 1 }, skippedTotal: 1 });
  });
});

describe("merging, not replacing", () => {
  const existing: VaultItem[] = [
    { id: "a1", name: "Mine", weight: 3, purity: "916", paidUsd: 300, date: "2025-05-05" },
  ];

  it("returns only the NEW items, so the caller can append them to the existing vault", () => {
    const r = run([{ ...good, id: "b2" }], existing);
    expect(r.ok && r.items.map((i) => i.id)).toEqual(["b2"]);
  });

  it("skips an id that already exists in the vault, and an id repeated inside the file", () => {
    const r = run(
      [
        { ...good, id: "a1" },
        { ...good, id: "z" },
        { ...good, id: "z" },
      ],
      existing,
    );
    expect(r).toMatchObject({ ok: true, imported: 1, skipped: { duplicate: 2 } });
  });
});
