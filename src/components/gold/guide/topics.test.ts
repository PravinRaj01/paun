import { describe, expect, it } from "vitest";
import { buildPages, CHAPTERS, isTopicId, pageIndexOf, TOPICS, type TopicId } from "./topics";
import { guideExample } from "./example";

describe("guide structure", () => {
  const pages = buildPages();
  const all = Object.keys(TOPICS) as TopicId[];

  it("puts every topic in exactly one chapter", () => {
    const listed = CHAPTERS.flatMap((c) => [...c.topics]);
    expect([...listed].sort()).toEqual([...all].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("starts with a cover, ends with a back cover, and has a page for every topic", () => {
    expect(pages[0]?.kind).toBe("cover");
    expect(pages.at(-1)?.kind).toBe("back");
    for (const id of all) expect(pageIndexOf(id, pages)).not.toBeNull();
  });

  it("keeps spreads full: the inner pages come in pairs, so the back cover stands alone", () => {
    expect((pages.length - 2) % 2).toBe(0);
  });

  it("numbers the topics 1..n in book order", () => {
    const ns = pages.flatMap((p) => (p.kind === "topic" ? [p.n] : []));
    expect(ns).toEqual(ns.map((_, i) => i + 1));
  });

  it("puts the worked example straight after 'how a price is built'", () => {
    const built = pageIndexOf("built", pages)!;
    expect(pages[built + 1]?.kind).toBe("example");
  });

  it("has the contents on one spread: chapter 1 on the left, the rest on the right", () => {
    expect(pages[1]).toMatchObject({ kind: "contents", part: 1 });
    expect(pages[2]).toMatchObject({ kind: "contents", part: 2 });
  });

  it("finds a topic's page, and nothing for an unknown id", () => {
    expect(pages[pageIndexOf("upah", pages)!]).toMatchObject({ kind: "topic", topic: "upah" });
    expect(pageIndexOf("nope", pages)).toBeNull();
    expect(isTopicId("susut")).toBe(true);
    expect(isTopicId("constructor")).toBe(false);
    expect(isTopicId(3)).toBe(false);
  });
});

describe("worked example", () => {
  it("comes from the engine: 10 g at RM 525 plus RM 150 upah is RM 5,400; sold back at RM 495 it is RM 4,950", () => {
    const e = guideExample();
    expect(e.total).toBe(5400);
    expect(e.payout).toBe(4950);
    expect(e.loss).toBe(450);
    expect(e.upah).toBe(150);
  });
});
