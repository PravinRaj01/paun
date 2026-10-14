import { ClipboardCheck, Coins, Gem, Hammer, Landmark, ListChecks, Percent, Receipt, Repeat, Ruler, Scale, Stamp, Store, type LucideIcon } from "lucide-react";
import type { CopyKey } from "@/lib/i18n";

/**
 * The structure of the guide, in one place: which topics there are, which chapter each belongs to, and in what order the pages of
 * the book run. The words are in the locale files; docs/guide-sources.md says where each claim comes from.
 */

export type TopicId = "board" | "built" | "purity" | "stamps" | "upah" | "receipt" | "buy" | "susut" | "tradein" | "sell" | "tax" | "units" | "bank";
export type ChapterId = "counter" | "selling" | "know";

export type Topic = { id: TopicId; icon: LucideIcon; title: CopyKey; body: CopyKey; ask: CopyKey };

export const TOPICS: Record<TopicId, Topic> = {
  board: { id: "board", icon: Store, title: "guideBoardTitle", body: "guideBoardBody", ask: "guideAskBoard" },
  built: { id: "built", icon: Scale, title: "guideBuiltTitle", body: "guideBuiltBody", ask: "guideAskBuilt" },
  purity: { id: "purity", icon: Gem, title: "guidePurityTitle", body: "guidePurityBody", ask: "guideAskPurity" },
  stamps: { id: "stamps", icon: Stamp, title: "guideStampsTitle", body: "guideStampsBody", ask: "guideAskStamps" },
  upah: { id: "upah", icon: Hammer, title: "guideUpahTitle", body: "guideUpahBody", ask: "guideAskUpah" },
  receipt: { id: "receipt", icon: Receipt, title: "guideReceiptTitle", body: "guideReceiptBody", ask: "guideAskReceipt" },
  buy: { id: "buy", icon: ClipboardCheck, title: "guideBuyTitle", body: "guideBuyBody", ask: "guideAskBuy" },
  susut: { id: "susut", icon: Percent, title: "guideSusutTitle", body: "guideSusutBody", ask: "guideAskSusut" },
  tradein: { id: "tradein", icon: Repeat, title: "guideTradeinTitle", body: "guideTradeinBody", ask: "guideAskTradein" },
  sell: { id: "sell", icon: ListChecks, title: "guideSellTitle", body: "guideSellBody", ask: "guideAskSell" },
  tax: { id: "tax", icon: Landmark, title: "guideTaxTitle", body: "guideTaxBody", ask: "guideAskTax" },
  units: { id: "units", icon: Ruler, title: "guideUnitsTitle", body: "guideUnitsBody", ask: "guideAskUnits" },
  bank: { id: "bank", icon: Coins, title: "guideBankTitle", body: "guideBankBody", ask: "guideAskBank" },
};

export const CHAPTERS: readonly { id: ChapterId; title: CopyKey; topics: readonly TopicId[] }[] = [
  { id: "counter", title: "guideChapterCounter", topics: ["board", "built", "purity", "stamps", "upah", "receipt", "buy"] },
  { id: "selling", title: "guideChapterSelling", topics: ["susut", "tradein", "sell"] },
  { id: "know", title: "guideChapterKnow", topics: ["tax", "units", "bank"] },
];

/** Where the worked example sits: right after "how a price is built", which it illustrates. */
const EXAMPLE_AFTER: TopicId = "built";

export type PageDef =
  | { kind: "cover" }
  | { kind: "contents"; part: 1 | 2 }
  | { kind: "howto" }
  | { kind: "chapter"; chapter: ChapterId; n: number }
  | { kind: "topic"; topic: TopicId; n: number }
  | { kind: "example" }
  | { kind: "words" }
  | { kind: "blank" }
  | { kind: "back" };

/**
 * Every page of the book, front cover to back cover. The inner pages always come in pairs so that every spread is full and the back
 * cover stands alone: a blank page is added when the count would be odd.
 */
export function buildPages(): PageDef[] {
  const pages: PageDef[] = [{ kind: "cover" }, { kind: "contents", part: 1 }, { kind: "contents", part: 2 }, { kind: "howto" }];
  let n = 0;
  CHAPTERS.forEach((chapter, c) => {
    pages.push({ kind: "chapter", chapter: chapter.id, n: c + 1 });
    for (const topic of chapter.topics) {
      n += 1;
      pages.push({ kind: "topic", topic, n });
      if (topic === EXAMPLE_AFTER) pages.push({ kind: "example" });
    }
  });
  pages.push({ kind: "words" });
  if ((pages.length + 1) % 2 !== 0) pages.push({ kind: "blank" });
  pages.push({ kind: "back" });
  return pages;
}

/** The page a topic is on, or null for an unknown id. */
export function pageIndexOf(topic: string, pages: readonly PageDef[] = buildPages()): number | null {
  const i = pages.findIndex((p) => p.kind === "topic" && p.topic === topic);
  return i < 0 ? null : i;
}

export const isTopicId = (v: unknown): v is TopicId => typeof v === "string" && Object.hasOwn(TOPICS, v);

