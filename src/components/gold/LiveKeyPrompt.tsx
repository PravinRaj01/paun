import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { shouldPromptForLiveKey } from "@/lib/gold";
import { useGold } from "@/lib/gold-store";
import { useI18n } from "@/lib/i18n";

/**
 * One-time invitation, shown inside the app (never on the landing page): "want a live price?".
 * Not a gate: closing it, or choosing the close, simply keeps the latest daily close. Either way it is remembered
 * (settings.livePromptSeen) so it never nags, and Settings always offers the key later.
 */
export function LiveKeyPrompt({ onAddKey }: { onAddKey: () => void }) {
  const { settings, setSettings, hydrated } = useGold();
  const { t } = useI18n();
  // wait until the saved settings are read, or a returning user who already answered would see it flash
  const open = hydrated && shouldPromptForLiveKey(settings);
  const markSeen = () => setSettings((s) => ({ ...s, livePromptSeen: true }));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) markSeen();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("livePromptTitle")}</DialogTitle>
          <DialogDescription>{t("livePromptBody")}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={markSeen}>
            {t("livePromptSkip")}
          </Button>
          <Button
            onClick={() => {
              markSeen();
              onAddKey();
            }}
          >
            {t("livePromptAdd")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
