import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatCalendarDate, formatCalendarMs, formatMoment, localToday } from "./datetime";

describe("a calendar date is the same day for everyone", () => {
  it("never slips to the previous day, whatever timezone the viewer is in", () => {
    const original = process.env["TZ"];
    try {
      for (const tz of ["America/Los_Angeles", "Pacific/Honolulu", "UTC", "Asia/Kuala_Lumpur", "Pacific/Auckland"]) {
        process.env["TZ"] = tz;
        expect(formatCalendarDate("2026-10-06", "en")).toBe("6 Oct 2026");
        expect(formatCalendarMs(Date.parse("2026-10-06T00:00:00Z"), "en", "short")).toBe("6 Oct");
      }
    } finally {
      if (original === undefined) delete process.env["TZ"];
      else process.env["TZ"] = original;
    }
  });

  it("supports the styles the charts use", () => {
    expect(formatCalendarDate("2026-10-06", "en", "weekday")).toBe("Tue, 6 Oct 2026");
    expect(formatCalendarDate("2026-10-06", "en", "month")).toBe("Oct 26");
    expect(formatCalendarDate("2026-10-06", "en", "short")).toBe("6 Oct");
  });

  it("formats in Bahasa Melayu", () => {
    expect(formatCalendarDate("2026-10-06", "ms")).toContain("2026");
    expect(formatCalendarDate("2026-10-06", "ms")).toMatch(/^6 /);
  });

  it("returns the text unchanged when it is not a date", () => {
    expect(formatCalendarDate("not a date", "en")).toBe("not a date");
  });
});

describe("a moment shows its timezone", () => {
  it("names the zone it is shown in", () => {
    const iso = "2026-10-07T03:34:00Z";
    expect(formatMoment(iso, "en", "Asia/Kuala_Lumpur")).toBe("7 Oct 2026, 11:34 GMT+8");
    expect(formatMoment(iso, "en", "UTC")).toBe("7 Oct 2026, 03:34 UTC");
    expect(formatMoment(iso, "en", "America/Los_Angeles")).toMatch(/^6 Oct 2026, 20:34 (GMT-7|PDT)$/);
  });

  it("is empty for an unreadable timestamp", () => {
    expect(formatMoment("", "en")).toBe("");
  });
});

describe("today for a date field is the viewer's local day", () => {
  it("gives the local date, not the UTC date", () => {
    const now = new Date("2026-10-06T23:30:00Z"); // 07:30 on 7 Oct in Kuala Lumpur, still 6 Oct in UTC
    expect(localToday(now, "Asia/Kuala_Lumpur")).toBe("2026-10-07");
    expect(localToday(now, "UTC")).toBe("2026-10-06");
    expect(localToday(now, "America/Los_Angeles")).toBe("2026-10-06");
  });
});

describe("components format dates only through datetime.ts", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [p] : [];
    });
  const files = [...walk("src/components/gold"), ...walk("src/routes")];

  it("scans some files", () => expect(files.length).toBeGreaterThan(10));

  it.each(["toLocaleDateString(", "toLocaleTimeString(", "toISOString().slice(0, 10)"])("no component uses %s", (banned) => {
    const offenders = files.filter((f) => readFileSync(f, "utf8").includes(banned));
    expect(offenders).toEqual([]);
  });

  it("no component calls toLocaleString on a Date", () => {
    const offenders = files.filter((f) => /new Date\([^)]*\)\.toLocaleString\(/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
