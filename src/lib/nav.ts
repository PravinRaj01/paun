/** The tabs the Check price page can open on (also what the old /arbitrage address asks for). */
export const CHECK_TABS = ["buy", "sell", "compare"] as const;
export type CheckTab = (typeof CHECK_TABS)[number];

export const parseCheckTab = (v: unknown): CheckTab | undefined => ((CHECK_TABS as readonly string[]).includes(v as string) ? (v as CheckTab) : undefined);
