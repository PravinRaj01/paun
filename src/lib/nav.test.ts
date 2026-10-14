import { describe, expect, it } from "vitest";
import { activeNav, CHECK_TABS, MORE_PATHS, parseCheckTab } from "./nav";

describe("activeNav: which dock icon is highlighted", () => {
  it.each([
    ["/dashboard", "check"],
    ["/vault", "vault"],
    ["/more", "more"],
    ["/markets", "more"],
    ["/dca", "more"],
    ["/countries", "more"],
  ])("%s -> %s", (path, id) => expect(activeNav(path)).toBe(id));

  it("everything reached from More highlights More", () => {
    for (const p of MORE_PATHS) expect(activeNav(p)).toBe("more");
  });

  it("the landing page and unknown pages highlight nothing", () => {
    expect(activeNav("/")).toBeNull();
    expect(activeNav("/nope")).toBeNull();
  });

  it("only the exact page counts, not a path that merely starts with the same letters", () => {
    expect(activeNav("/vaults")).toBeNull();
    expect(activeNav("/dashboards")).toBeNull();
    expect(activeNav("/marketsplace")).toBeNull();
  });

  it("the old /arbitrage address is not an icon of its own (it redirects)", () => {
    expect(activeNav("/arbitrage")).toBeNull();
  });
});

describe("parseCheckTab", () => {
  it("accepts the three tabs and nothing else", () => {
    for (const t of CHECK_TABS) expect(parseCheckTab(t)).toBe(t);
    expect(parseCheckTab("nope")).toBeUndefined();
    expect(parseCheckTab(undefined)).toBeUndefined();
    expect(parseCheckTab(3)).toBeUndefined();
  });
});
