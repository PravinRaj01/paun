import { describe, expect, it } from "vitest";
import { CHECK_TABS, parseCheckTab } from "./nav";

describe("parseCheckTab", () => {
  it("accepts the three tabs and nothing else", () => {
    for (const t of CHECK_TABS) expect(parseCheckTab(t)).toBe(t);
    expect(parseCheckTab("nope")).toBeUndefined();
    expect(parseCheckTab(undefined)).toBeUndefined();
    expect(parseCheckTab(3)).toBeUndefined();
  });
});
