import { describe, expect, it } from "vitest";
import {
  activeDock,
  addToDock,
  canAdd,
  canRemove,
  DEFAULT_DOCK,
  DOCK_IDS,
  inMore,
  LOCKED,
  MAX_DOCK,
  moveInDock,
  normalizeDock,
  removeFromDock,
  type DockId,
} from "./dock";

describe("the default is ours", () => {
  it("Check price, My gold, More, Guide, View options, Settings", () => {
    expect([...DEFAULT_DOCK]).toEqual(["check", "vault", "more", "guide", "view", "settings"]);
  });

  it("is a valid dock as it stands, and fits the limit", () => {
    expect(normalizeDock([...DEFAULT_DOCK])).toEqual([...DEFAULT_DOCK]);
    expect(DEFAULT_DOCK.length).toBeLessThanOrEqual(MAX_DOCK);
  });

  it("leaves price history, the monthly plan and compare countries under More", () => {
    expect(inMore([...DEFAULT_DOCK])).toEqual(["markets", "dca", "countries"]);
  });
});

describe("normalizeDock: whatever is saved becomes a valid dock", () => {
  it("anything that is not a list gives the default", () => {
    for (const bad of [null, undefined, "check", 7, { a: 1 }]) expect(normalizeDock(bad)).toEqual([...DEFAULT_DOCK]);
  });

  it("keeps the person's order", () => {
    expect(normalizeDock(["settings", "more", "check", "view"])).toEqual(["settings", "more", "check", "view"]);
  });

  it("drops unknown names and repeats", () => {
    expect(normalizeDock(["check", "nope", "check", 5, "more", "view"])).toEqual(["check", "more", "view"]);
  });

  it("puts More and View options back if they are missing", () => {
    const out = normalizeDock(["check"]);
    expect(out).toContain("more");
    expect(out).toContain("view");
    expect(out[0]).toBe("check");
  });

  it("an empty list keeps only the two that cannot go", () => {
    expect([...normalizeDock([])].sort()).toEqual([...LOCKED].sort());
  });

  it("trims a dock that is too long, removing from the end and never More or View options", () => {
    const out = normalizeDock(["more", "view", "check", "vault", "markets", "dca", "countries", "guide", "settings"]);
    expect(out).toHaveLength(MAX_DOCK);
    expect(out).toContain("more");
    expect(out).toContain("view");
    expect(out.slice(0, 5)).toEqual(["more", "view", "check", "vault", "markets"]);
  });

  it("trims from the end even when the locked ones are last", () => {
    const out = normalizeDock(["check", "vault", "markets", "dca", "countries", "guide", "settings", "more", "view"]);
    expect(out).toHaveLength(MAX_DOCK);
    expect(out.slice(-2)).toEqual(["more", "view"]);
    expect(out.slice(0, 5)).toEqual(["check", "vault", "markets", "dca", "countries"]);
  });
});

describe("moving pages between the dock and More", () => {
  const d = [...DEFAULT_DOCK];

  it("a page taken out of the dock shows under More", () => {
    const out = removeFromDock(d, "guide");
    expect(out).not.toContain("guide");
    expect(inMore(out)).toContain("guide");
  });

  it("a page put in the dock leaves More and goes last", () => {
    const out = addToDock(d, "markets");
    expect(out[out.length - 1]).toBe("markets");
    expect(inMore(out)).not.toContain("markets");
  });

  it("More and View options cannot be taken out", () => {
    for (const id of LOCKED) {
      expect(canRemove(d, id)).toBe(false);
      expect(removeFromDock(d, id)).toEqual(d);
    }
  });

  it("nothing is added twice, and nothing is added to a full dock", () => {
    expect(addToDock(d, "check")).toEqual(d);
    const full = addToDock(addToDock(d, "markets"), "dca");
    expect(full).toHaveLength(MAX_DOCK);
    expect(canAdd(full, "countries")).toBe(false);
    expect(addToDock(full, "countries")).toEqual(full);
  });

  it("every entry is either in the dock or under More or one of the two that never leave", () => {
    for (const id of DOCK_IDS) {
      const where = d.includes(id) ? "dock" : inMore(d).includes(id) ? "more" : "none";
      expect(where).not.toBe("none");
    }
  });
});

describe("moveInDock", () => {
  const d: DockId[] = ["check", "vault", "more", "guide", "view", "settings"];

  it("moves one place earlier or later", () => {
    expect(moveInDock(d, "more", -1)).toEqual(["check", "more", "vault", "guide", "view", "settings"]);
    expect(moveInDock(d, "vault", 1)).toEqual(["check", "more", "vault", "guide", "view", "settings"]);
  });

  it("does nothing at either end, or for something that is not in the dock", () => {
    expect(moveInDock(d, "check", -1)).toEqual(d);
    expect(moveInDock(d, "settings", 1)).toEqual(d);
    expect(moveInDock(d, "markets", 1)).toEqual(d);
  });

  it("returns a new list and leaves the old one alone", () => {
    const before = [...d];
    moveInDock(d, "more", -1);
    expect(d).toEqual(before);
  });
});

describe("activeDock: which icon is highlighted", () => {
  const d = [...DEFAULT_DOCK];

  it("a page that is in the dock highlights its own icon", () => {
    expect(activeDock("/dashboard", d)).toBe("check");
    expect(activeDock("/vault", d)).toBe("vault");
    expect(activeDock("/settings", d)).toBe("settings");
  });

  it("More, and every page that lives under More, highlights More", () => {
    for (const p of ["/more", "/markets", "/dca", "/countries"]) expect(activeDock(p, d)).toBe("more");
  });

  it("a page moved into the dock highlights its own icon instead of More", () => {
    expect(activeDock("/markets", addToDock(d, "markets"))).toBe("markets");
  });

  it("a page moved out of the dock now highlights More", () => {
    const out = removeFromDock(d, "vault");
    expect(activeDock("/vault", out)).toBe("more");
    expect(activeDock("/settings", removeFromDock(d, "settings"))).toBe("more");
  });

  it("the landing page and unknown pages highlight nothing", () => {
    expect(activeDock("/", d)).toBeNull();
    expect(activeDock("/nope", d)).toBeNull();
  });

  it("only the exact page counts, not one that merely starts with the same letters", () => {
    expect(activeDock("/vaults", d)).toBeNull();
    expect(activeDock("/dashboards", d)).toBeNull();
  });
});
