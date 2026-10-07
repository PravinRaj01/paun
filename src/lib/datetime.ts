import type { Language } from "./i18n";

/**
 * The one place dates and times are formatted for display (PLAN.md, constraint 11: every date or time states its timezone).
 *
 * Three kinds of value, three rules:
 *  - a CALENDAR DATE ("2026-10-06": a market trading day, or a day the user typed) is formatted as the same calendar day for
 *    everyone. It is never converted to a clock time, so it cannot slip to the previous day for viewers west of UTC;
 *  - a MOMENT (an ISO timestamp, e.g. when a price was set) is shown in the viewer's own timezone, with the zone name;
 *  - "today" for a date field is the viewer's local date, not the UTC date.
 */
const locale = (lang: Language) => (lang === "ms" ? "ms-MY" : "en-GB");

export type DateStyle = "short" | "month" | "long" | "weekday";

const STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { day: "numeric", month: "short" },
  month: { month: "short", year: "2-digit" },
  long: { day: "numeric", month: "short", year: "numeric" },
  weekday: { weekday: "short", day: "numeric", month: "short", year: "numeric" },
};

/** "2026-10-06" -> "6 Oct 2026". Formatted in UTC on purpose: the string is a calendar day, not an instant. */
export function formatCalendarDate(ymd: string, lang: Language, style: DateStyle = "long"): string {
  const ms = Date.parse(`${ymd}T00:00:00Z`);
  if (!Number.isFinite(ms)) return ymd;
  return new Intl.DateTimeFormat(locale(lang), { ...STYLES[style], timeZone: "UTC" }).format(ms);
}

/** The same, for a chart axis that holds UTC-midnight milliseconds (what `Date.parse("YYYY-MM-DDT00:00:00Z")` gives). */
export const formatCalendarMs = (ms: number, lang: Language, style: DateStyle = "long") =>
  new Intl.DateTimeFormat(locale(lang), { ...STYLES[style], timeZone: "UTC" }).format(ms);

/** An ISO timestamp -> "7 Oct 2026, 11:34 GMT+8" in the viewer's timezone (or `timeZone`, which the tests use). */
export function formatMoment(iso: string, lang: Language, timeZone?: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat(locale(lang), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(ms);
}

/** "12 minutes ago" / "2 hours ago" / "now", in the page's language. Just a distance, so it needs no zone. */
export function formatAgo(iso: string, now: Date, lang: Language): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: "auto" });
  const secs = Math.max(0, Math.round((now.getTime() - ms) / 1000));
  if (secs < 60) return rtf.format(0, "second");
  if (secs < 3600) return rtf.format(-Math.floor(secs / 60), "minute");
  if (secs < 86_400) return rtf.format(-Math.floor(secs / 3600), "hour");
  return rtf.format(-Math.floor(secs / 86_400), "day");
}

/** Today's date as "YYYY-MM-DD" in the viewer's timezone (`toISOString().slice(0, 10)` would give the UTC date). */
export function localToday(now: Date = new Date(), timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(now);
}
