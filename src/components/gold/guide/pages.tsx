import type { CSSProperties, ReactNode } from "react";
import { BookOpen, ClipboardCheck, Hammer, ListChecks, Scale, Store, Wallet } from "lucide-react";
import { fmt } from "@/lib/gold";
import { useI18n } from "@/lib/i18n";
import { guideExample } from "./example";
import { CHAPTERS, TOPICS, type PageDef, type TopicId } from "./topics";

export type Metrics = { width: number; height: number; portrait: boolean };
type Nav = { goTo: (index: number) => void; pageOf: (topic: TopicId) => number; contentsPage: number };

/** Sizes that follow the page, so the same text fits a 288 px page and a 380 px one. */
function sizes(width: number) {
  const k = Math.max(0.82, Math.min(1.1, width / 330));
  return { pad: width < 300 ? 18 : 24, body: Math.round(14 * k * 10) / 10, small: Math.round(12 * k * 10) / 10, title: Math.round(20 * k * 10) / 10 };
}

const gold = "text-gold";
const muted = "text-muted-foreground";

/** One physical page: paper, the shaded edge where it is bound, and its number. */
function Leaf({ index, total, metrics, hard, children }: { index: number; total: number; metrics: Metrics; hard?: boolean; children: ReactNode }) {
  const s = sizes(metrics.width);
  // in a spread, odd pages are on the left and bound on their right edge; one page at a time, every page is bound on the left
  const boundRight = !metrics.portrait && index % 2 === 1;
  const number = index > 0 && index < total - 1 ? index + 1 : null; // the same number the page counter shows
  const style: CSSProperties = { width: metrics.width, height: metrics.height, padding: s.pad };
  return (
    <div
      className={`guide-paper relative flex flex-col overflow-hidden ${hard ? "guide-cover text-[#f1e6cf]" : "bg-card text-card-foreground"}`}
      style={style}
    >
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 w-7 ${boundRight ? "right-0 bg-gradient-to-l" : "left-0 bg-gradient-to-r"} from-black/20 to-transparent`}
      />
      <div className="relative min-h-0 flex-1">{children}</div>
      {number !== null && <div className={`num relative text-center ${muted}`} style={{ fontSize: s.small - 2 }}>{number}</div>}
    </div>
  );
}

function Title({ children, metrics }: { children: ReactNode; metrics: Metrics }) {
  return <h3 className="font-display leading-tight" style={{ fontSize: sizes(metrics.width).title }}>{children}</h3>;
}

function Rule() {
  return <div className="my-3 h-px w-10 bg-gold" />;
}

export function renderPage(def: PageDef, index: number, total: number, metrics: Metrics, nav: Nav): ReactNode {
  return (
    <Leaf key={index} index={index} total={total} metrics={metrics} hard={def.kind === "cover" || def.kind === "back"}>
      <PageBody def={def} metrics={metrics} nav={nav} />
    </Leaf>
  );
}

function PageBody({ def, metrics, nav }: { def: PageDef; metrics: Metrics; nav: Nav }) {
  const { t } = useI18n();
  const s = sizes(metrics.width);

  switch (def.kind) {
    case "cover":
      return (
        <div className="flex h-full flex-col items-center justify-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-[#c9a24a]/60 text-[#e3bd5f]"><BookOpen className="h-6 w-6" /></div>
          <div className="font-brand text-3xl tracking-wide">P<span className="text-[#e3bd5f]">au</span>n</div>
          <div className="mt-2 font-display text-xl text-[#e3bd5f]">{t("guide")}</div>
          <div className="mx-auto my-4 h-px w-12 bg-[#c9a24a]/60" />
          <p className="max-w-[16rem] leading-5 text-[#f1e6cf]/75" style={{ fontSize: s.small }}>{t("guideCover")}</p>
        </div>
      );

    case "contents": {
      const chapters = def.part === 1 ? CHAPTERS.slice(0, 1) : CHAPTERS.slice(1);
      return (
        <div className="flex h-full flex-col">
          <Title metrics={metrics}>{def.part === 1 ? t("guideContentsTitle") : " "}</Title>
          <Rule />
          <div className="space-y-4 overflow-hidden">
            {chapters.map((c) => (
              <div key={c.id}>
                <div className={`font-medium uppercase tracking-wider ${gold}`} style={{ fontSize: s.small }}>
                  {t("guideChapterN", { n: CHAPTERS.indexOf(c) + 1 })} · {t(c.title)}
                </div>
                <ul className="mt-1.5 space-y-0.5">
                  {c.topics.map((id) => (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => nav.goTo(nav.pageOf(id))}
                        className="flex w-full items-baseline justify-between gap-3 rounded py-0.5 text-left hover:text-gold"
                        style={{ fontSize: s.body }}
                      >
                        <span className="min-w-0 truncate">{t(TOPICS[id].title)}</span>
                        <span className={`num shrink-0 ${muted}`} style={{ fontSize: s.small }}>{nav.pageOf(id) + 1}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      );
    }

    case "howto": {
      const jobs = [
        { icon: ClipboardCheck, text: t("guideJobCheck") },
        { icon: Hammer, text: t("guideJobSell") },
        { icon: ListChecks, text: t("guideJobCompare") },
        { icon: Wallet, text: t("guideJobMine") },
      ];
      return (
        <div>
          <Title metrics={metrics}>{t("guideHowToTitle")}</Title>
          <Rule />
          <ul className="space-y-3.5">
            {jobs.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${gold}`} />
                <span className="leading-6" style={{ fontSize: s.body }}>{text}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    }

    case "chapter": {
      const c = CHAPTERS.find((x) => x.id === def.chapter)!;
      return (
        <div className="flex h-full flex-col items-center justify-center text-center">
          <div className={`num ${muted} uppercase tracking-[0.3em]`} style={{ fontSize: s.small }}>{t("guideChapterN", { n: def.n })}</div>
          <div className={`font-display ${gold}`} style={{ fontSize: s.title * 2.6, lineHeight: 1.1 }}>{def.n}</div>
          <div className="mx-auto my-3 h-px w-10 bg-gold" />
          <div className="font-display" style={{ fontSize: s.title }}>{t(c.title)}</div>
        </div>
      );
    }

    case "topic": {
      const topic = TOPICS[def.topic];
      const Icon = topic.icon;
      return (
        <div>
          <div className="flex items-center justify-between">
            <div className={`num ${gold}`} style={{ fontSize: s.small }}>{String(def.n).padStart(2, "0")}</div>
            <button type="button" onClick={() => nav.goTo(nav.contentsPage)} className={`rounded px-1 uppercase tracking-wider hover:text-gold ${muted}`} style={{ fontSize: s.small - 1 }}>
              {t("guideContentsTitle")}
            </button>
          </div>
          <Icon className={`mt-3 h-6 w-6 ${gold}`} />
          <div className="mt-2"><Title metrics={metrics}>{t(topic.title)}</Title></div>
          <Rule />
          <p className={`leading-6 ${muted}`} style={{ fontSize: s.body }}>{t(topic.body)}</p>
          <div className="mt-4 border-l-2 border-gold bg-gold-soft px-3 py-2">
            <div className={`font-medium uppercase tracking-wider ${gold}`} style={{ fontSize: s.small - 1 }}>{t("guideAsk")}</div>
            <p className="mt-0.5 leading-5" style={{ fontSize: s.body }}>{t(topic.ask)}</p>
          </div>
        </div>
      );
    }

    case "example": {
      const e = guideExample();
      const money = (n: number) => fmt(n, "MYR", 0);
      return (
        <div>
          <div className={`num ${gold}`} style={{ fontSize: s.small }}>{t("guideExampleTitle")}</div>
          <Scale className={`mt-3 h-6 w-6 ${gold}`} aria-hidden />
          <div className="mt-2"><Title metrics={metrics}>{money(e.loss)}</Title></div>
          <Rule />
          <p className={`leading-6 ${muted}`} style={{ fontSize: s.body }}>
            {t("guideExampleBody", {
              weight: e.weight,
              rate: money(e.shopRate),
              upah: money(e.upah),
              total: money(e.total),
              buyback: money(e.buyBackRate),
              payout: money(e.payout),
              loss: money(e.loss),
            })}
          </p>
          <p className={`mt-3 ${muted}`} style={{ fontSize: s.small - 1 }}>{t("guideExampleNote")}</p>
        </div>
      );
    }

    case "words": {
      const rows = [
        ["guideTermUpah", "guideMeanUpah"],
        ["guideTermSusut", "guideMeanSusut"],
        ["guideTermBuyBack", "guideMeanBuyBack"],
        ["guideTermTradeIn", "guideMeanTradeIn"],
        ["guideTermMarkup", "guideMeanMarkup"],
      ] as const;
      return (
        <div>
          <Title metrics={metrics}>{t("guideWordsTitle")}</Title>
          <Rule />
          <dl className="space-y-2.5">
            {rows.map(([term, mean]) => (
              <div key={term}>
                <dt className={`font-medium ${gold}`} style={{ fontSize: s.body }}>{t(term)}</dt>
                <dd className={`leading-5 ${muted}`} style={{ fontSize: s.small }}>{t(mean)}</dd>
              </div>
            ))}
          </dl>
        </div>
      );
    }

    case "blank":
      return (
        <div className="flex h-full items-center justify-center">
          <Store className="h-5 w-5 opacity-10" aria-hidden />
        </div>
      );

    case "back":
      return (
        <div className="flex h-full flex-col items-center justify-center text-center">
          <div className="font-brand text-4xl text-[#e3bd5f]">P<span className="opacity-60">au</span>n</div>
          <div className="mx-auto my-4 h-px w-12 bg-[#c9a24a]/60" />
          <div className="font-display text-lg text-[#e3bd5f]">{t("guideBackTitle")}</div>
          <p className="mt-3 max-w-[16rem] leading-5 text-[#f1e6cf]/75" style={{ fontSize: s.small }}>{t("guideBackBody")}</p>
        </div>
      );
  }
}

