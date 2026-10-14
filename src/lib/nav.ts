/**
 * The five places the main navigation offers (PLAN.md section 5): Today, Check price, My gold, Guide, More.
 * Everything that is not one of the four jobs lives under More, so it is the highlighted tab on those pages.
 */
export type NavId = "today" | "check" | "vault" | "guide" | "more";

/** Pages reached from the More page. */
export const MORE_PATHS = ["/more", "/markets", "/dca", "/countries", "/world"] as const;

/** Which tab is highlighted on this path (null for a page the navigation does not know). */
export function activeNav(path: string): NavId | null {
  if (path === "/" || path === "") return "today";
  if (path === "/dashboard" || path.startsWith("/dashboard/")) return "check";
  if (path === "/vault" || path.startsWith("/vault/")) return "vault";
  if (MORE_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return "more";
  return null;
}

/** The tabs the Check price page can open on (also what the Today buttons and the old /arbitrage address ask for). */
export const CHECK_TABS = ["buy", "sell", "compare"] as const;
export type CheckTab = (typeof CHECK_TABS)[number];

export const parseCheckTab = (v: unknown): CheckTab | undefined => (CHECK_TABS as readonly string[]).includes(v as string) ? (v as CheckTab) : undefined;
