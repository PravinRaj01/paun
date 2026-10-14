import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/** One quiet line when the connection drops, so a stale price is never mistaken for a live one. */
export function OfflineNotice() {
  const { t } = useI18n();
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  if (online) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 border-b bg-muted px-4 py-1.5 text-xs text-muted-foreground">
      <WifiOff className="h-3.5 w-3.5" aria-hidden /> {t("offlineNotice")}
    </div>
  );
}
