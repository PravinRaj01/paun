import { useEffect, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Turnstile } from "@/components/gold/Turnstile";
import { requestScan, scanErrorKey, type ScanResponse } from "@/lib/scan";
import { resizeToJpegBase64 } from "@/lib/scan-image";
import { useI18n, type CopyKey } from "@/lib/i18n";

/**
 * "Scan receipt": pick or take a photo, shrink it in the browser, prove you are a person (Turnstile), send it to our Worker, and
 * hand the reading back to the Vault page, which fills its own form. Nothing is saved here, and the photo is never kept: it lives
 * in this dialog's memory until the dialog closes.
 */
export function ScanReceiptDialog({
  open,
  onOpenChange,
  onRead,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRead: (result: ScanResponse) => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("scanTitle")}</DialogTitle>
          <DialogDescription>{t("scanIntro")}</DialogDescription>
        </DialogHeader>
        {/* mounted only while open, so every opening starts clean (no old photo, no old token) */}
        {open && <ScanBody onClose={() => onOpenChange(false)} onRead={onRead} />}
        <DialogFooter>
          <p className="mr-auto text-[11px] leading-snug text-muted-foreground">{t("scanPrivacy")}</p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScanBody({ onClose, onRead }: { onClose: () => void; onRead: (result: ScanResponse) => void }) {
  const { t, language } = useI18n();
  const pick = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [widget, setWidget] = useState(0); // a new key = a new Turnstile widget = a new one-time token
  const [challengeFailed, setChallengeFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CopyKey | null>(null);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Emptied just BEFORE the picker opens (not right after a photo is chosen, which can invalidate the chosen file), so that
  // choosing the same photo again still fires onChange.
  const openPicker = () => {
    if (pick.current) pick.current.value = "";
    pick.current?.click();
  };

  const freshCheck = () => {
    setToken(null);
    setChallengeFailed(false);
    setWidget((n) => n + 1);
  };

  const scan = async () => {
    if (!file || !token || busy) return;
    setBusy(true);
    setError(null);
    let image: string;
    try {
      image = await resizeToJpegBase64(file);
    } catch {
      setBusy(false);
      setError("scanErrDecode");
      return;
    }
    const res = await requestScan(image, "image/jpeg", token);
    setBusy(false);
    if (!res.ok) {
      setError(scanErrorKey(res.error));
      freshCheck(); // the token is spent whatever the outcome
      return;
    }
    onRead(res);
    onClose();
  };

  return (
    <div className="space-y-3">
      <input
        ref={pick}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          if (f) {
            setFile(f);
            setError(null);
          }
        }}
      />
      {!file ? (
        <Button className="w-full" variant="outline" onClick={openPicker}>
          <Camera className="mr-2 h-4 w-4" />
          {t("scanChoose")}
        </Button>
      ) : (
        <>
          {preview && <img src={preview} alt="" className="mx-auto max-h-52 rounded-md border object-contain" />}
          <Button variant="link" className="h-auto p-0 text-xs" onClick={openPicker} disabled={busy}>
            {t("scanChange")}
          </Button>
          <Turnstile key={widget} onToken={setToken} onError={() => setChallengeFailed(true)} language={language} />
          {challengeFailed && (
            <div className="flex items-center gap-2 text-xs text-destructive">
              <span>{t("scanErrTurnstile")}</span>
              <Button size="sm" variant="outline" onClick={freshCheck}>
                {t("scanRetryCheck")}
              </Button>
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      )}
      {file && (
        <Button className="w-full" onClick={scan} disabled={!token || busy}>
          {busy ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("scanning")}
            </>
          ) : token ? (
            t("scanRun")
          ) : (
            t("scanWaitCheck")
          )}
        </Button>
      )}
    </div>
  );
}
