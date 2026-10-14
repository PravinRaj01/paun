import { ArrowDown, ArrowUp, Lock, Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addToDock, canAdd, canRemove, DEFAULT_DOCK, inMore, MAX_DOCK, moveInDock, removeFromDock, type DockId } from "@/lib/dock";
import { useGold } from "@/lib/gold-store";
import { useI18n } from "@/lib/i18n";
import { DOCK_ITEMS } from "./dock-registry";

/** Settings > Your dock: what sits in the bar, in what order, and what is left under More. The default is ours. */
export function DockArranger() {
  const { dock, setDock } = useGold();
  const { t } = useI18n();
  const more = inMore(dock);
  const isDefault = dock.length === DEFAULT_DOCK.length && dock.every((id, i) => id === DEFAULT_DOCK[i]);
  const name = (id: DockId) => t(DOCK_ITEMS[id].label); // the short name the icon carries in the dock

  return (
    <section className="space-y-5 rounded-lg border bg-card p-4 sm:p-5" aria-labelledby="dock-title">
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="dock-title" className="font-display text-xl">
            {t("dockTitle")}
          </h3>
          <span className="num text-xs text-muted-foreground">{t("dockCount", { n: dock.length, max: MAX_DOCK })}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t("dockHint")}</p>
      </div>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{t("dockIn")}</div>
        <ol className="divide-y rounded-lg border">
          {dock.map((id, i) => {
            const Icon = DOCK_ITEMS[id].icon;
            const locked = !canRemove(dock, id);
            return (
              <li key={id} className="flex items-center gap-2 px-3 py-2" data-testid={`dock-in-${id}`}>
                <Icon className="h-5 w-5 shrink-0 text-gold" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{name(id)}</span>
                  {locked && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="h-3 w-3" aria-hidden /> {t("dockLocked")}
                    </span>
                  )}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9"
                  disabled={i === 0}
                  aria-label={`${t("dockUp")}: ${name(id)}`}
                  onClick={() => setDock((d) => moveInDock(d, id, -1))}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9"
                  disabled={i === dock.length - 1}
                  aria-label={`${t("dockDown")}: ${name(id)}`}
                  onClick={() => setDock((d) => moveInDock(d, id, 1))}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                {!locked && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9"
                    aria-label={`${t("dockToMore")}: ${name(id)}`}
                    title={t("dockToMore")}
                    onClick={() => setDock((d) => removeFromDock(d, id))}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{t("dockOut")}</div>
        {more.length ? (
          <ul className="divide-y rounded-lg border">
            {more.map((id) => {
              const Icon = DOCK_ITEMS[id].icon;
              return (
                <li key={id} className="flex items-center gap-2 px-3 py-2" data-testid={`dock-more-${id}`}>
                  <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{name(id)}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9"
                    disabled={!canAdd(dock, id)}
                    aria-label={`${t("dockToDock")}: ${name(id)}`}
                    title={canAdd(dock, id) ? t("dockToDock") : t("dockFull")}
                    onClick={() => setDock((d) => addToDock(d, id))}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{t("dockMoreEmpty")}</p>
        )}
        {dock.length >= MAX_DOCK && more.length > 0 && <p className="text-xs text-muted-foreground">{t("dockFull")}</p>}
      </div>

      <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" disabled={isDefault} onClick={() => setDock([...DEFAULT_DOCK])}>
        <RotateCcw className="h-4 w-4" /> {t("dockReset")}
      </Button>
    </section>
  );
}
