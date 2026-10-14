/**
 * What can sit in the dock, which pages are reached from More, and how a person's arrangement is kept sane.
 *
 * The default is ours: Check price, My gold, More, Guide, View options, Settings. A person may move the pages between the dock and
 * More and put the dock's icons in the order they like. More (the way to everything not in the dock) and View options (the popover
 * with Simple / Pro, price basis and language) always stay in the dock.
 */
export const DOCK_IDS = ["check", "vault", "markets", "dca", "countries", "guide", "more", "view", "settings"] as const;
export type DockId = (typeof DOCK_IDS)[number];

export const DEFAULT_DOCK: readonly DockId[] = ["check", "vault", "more", "guide", "view", "settings"];

/** Always in the dock: More, or the rest could not be reached; View options, the only home of the price-basis switch. */
export const LOCKED: readonly DockId[] = ["more", "view"];

/** The dock holds at most this many icons, so that it fits a 360 px phone with room to spare. */
export const MAX_DOCK = 7;

/** The page each entry opens (Guide opens the guide, View options a popover: no page). */
export const PAGE_PATH: Readonly<Partial<Record<DockId, string>>> = {
  check: "/dashboard",
  vault: "/vault",
  markets: "/markets",
  dca: "/dca",
  countries: "/countries",
  more: "/more",
  settings: "/settings",
};

const isId = (x: unknown): x is DockId => typeof x === "string" && (DOCK_IDS as readonly string[]).includes(x);
const isLocked = (id: DockId) => (LOCKED as readonly DockId[]).includes(id);

/**
 * Whatever is saved (a list that may be old, edited by hand, or from a version with other icons) as a dock that is always valid:
 * known icons only, none twice, the locked ones present, and no more than MAX_DOCK (the ones a person can remove go first, from the end).
 * Something that is not a list at all gives the default.
 */
export function normalizeDock(raw: unknown): DockId[] {
  if (!Array.isArray(raw)) return [...DEFAULT_DOCK];
  const out: DockId[] = [];
  for (const x of raw) if (isId(x) && !out.includes(x)) out.push(x);
  for (const l of LOCKED) if (!out.includes(l)) out.push(l);
  while (out.length > MAX_DOCK) {
    let i = out.length - 1;
    while (i >= 0 && isLocked(out[i]!)) i--;
    if (i < 0) break; // nothing removable left
    out.splice(i, 1);
  }
  return out;
}

/** The pages that are not in the dock, so they are listed under More (in a fixed, familiar order). */
export const inMore = (dock: readonly DockId[]): DockId[] => DOCK_IDS.filter((id) => !isLocked(id) && !dock.includes(id));

export const canAdd = (dock: readonly DockId[], id: DockId) => !dock.includes(id) && dock.length < MAX_DOCK;
export const canRemove = (dock: readonly DockId[], id: DockId) => dock.includes(id) && !isLocked(id);

/** Put a page in the dock, at the end. Does nothing if it is already there or the dock is full. */
export function addToDock(dock: readonly DockId[], id: DockId): DockId[] {
  return canAdd(dock, id) ? [...dock, id] : [...dock];
}

/** Take a page out of the dock (it then lives under More). The locked ones cannot be removed. */
export function removeFromDock(dock: readonly DockId[], id: DockId): DockId[] {
  return canRemove(dock, id) ? dock.filter((x) => x !== id) : [...dock];
}

/** Move one icon a place earlier (-1) or later (+1). At either end, nothing moves. */
export function moveInDock(dock: readonly DockId[], id: DockId, by: -1 | 1): DockId[] {
  const i = dock.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= dock.length) return [...dock];
  const next = [...dock];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/**
 * Which dock icon is highlighted on this path. A page that is in the dock highlights its own icon; a page that lives under More
 * (or More itself) highlights More. The landing page and unknown pages highlight nothing.
 */
export function activeDock(path: string, dock: readonly DockId[]): DockId | null {
  for (const id of DOCK_IDS) {
    const p = PAGE_PATH[id];
    if (!p || !(path === p || path.startsWith(`${p}/`))) continue;
    return id === "more" || dock.includes(id) ? (id === "more" ? "more" : id) : "more";
  }
  return null;
}
