import { ArrowLeftRight, BookOpen, Calculator, LayoutGrid, LineChart, PiggyBank, Settings2, SlidersHorizontal, Vault, type LucideIcon } from "lucide-react";
import type { CopyKey } from "@/lib/i18n";
import type { DockId } from "@/lib/dock";

/** How each entry looks and what it is called: the dock, the More page and the arranger in Settings all read this one table. */
export const DOCK_ITEMS: Record<DockId, { icon: LucideIcon; label: CopyKey; moreTitle?: CopyKey; moreHint?: CopyKey }> = {
  check: { icon: Calculator, label: "navCheck", moreHint: "moreCheckHint" },
  vault: { icon: Vault, label: "navVault", moreHint: "moreVaultHint" },
  markets: { icon: LineChart, label: "navMarkets", moreTitle: "moreMarkets", moreHint: "moreMarketsHint" },
  dca: { icon: PiggyBank, label: "navDca", moreTitle: "moreDca", moreHint: "moreDcaHint" },
  countries: { icon: ArrowLeftRight, label: "navCountries", moreTitle: "moreCountries", moreHint: "moreCountriesHint" },
  guide: { icon: BookOpen, label: "guide", moreHint: "moreGuideHint" },
  more: { icon: LayoutGrid, label: "navMore" },
  view: { icon: SlidersHorizontal, label: "viewOptions" },
  settings: { icon: Settings2, label: "settings", moreHint: "moreSettingsHint" },
};
