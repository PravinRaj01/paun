/**
 * Which dock icon is highlighted. Everything that is not one of the main jobs lives under More, so More is the highlighted icon
 * on those pages.
 */
export type NavId = "check" | "vault" | "more";

/** Pages reached from the More page. */
export const MORE_PATHS = ["/more", "/markets", "/dca", "/countries"] as const;

/** Which icon is highlighted on this path (null for a page the dock does not own, such as the landing page). */
export function activeNav(path: string): NavId | null {
  if (path === "/dashboard" || path.startsWith("/dashboard/")) return "check";
  if (path === "/vault" || path.startsWith("/vault/")) return "vault";
  if (MORE_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return "more";
  return null;
}

/** The tabs the Check price page can open on (also what the old /arbitrage address asks for). */
export const CHECK_TABS = ["buy", "sell", "compare"] as const;
export type CheckTab = (typeof CHECK_TABS)[number];

export const parseCheckTab = (v: unknown): CheckTab | undefined => ((CHECK_TABS as readonly string[]).includes(v as string) ? (v as CheckTab) : undefined);
