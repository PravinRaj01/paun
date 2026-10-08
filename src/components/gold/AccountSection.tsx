import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GoogleSignInButton } from "@/components/gold/GoogleSignInButton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { accountsPreviewEnabled, useAccount, type AccountError } from "@/lib/account";
import { formatAgo, formatMoment } from "@/lib/datetime";
import { resetSyncStatus, syncNow, useSyncStatus } from "@/lib/sync-status";
import { clearSyncState, type SyncError } from "@/lib/vault-sync";
import { useI18n, type CopyKey } from "@/lib/i18n";

const ERROR_COPY: Record<AccountError, CopyKey> = {
  network: "acctErrNetwork",
  rejected: "acctErrRejected",
  rate_limited: "acctErrLimit",
  unavailable: "acctErrUnavailable",
};

const SYNC_ERROR_COPY: Record<SyncError, CopyKey> = {
  offline: "syncOffline",
  signed_out: "syncSignedOut",
  rate_limited: "syncRateLimited",
  too_many: "syncLimit",
  invalid: "syncError",
  unavailable: "syncError",
};

/** Re-renders every minute so "3 min ago" stays honest while the dialog is open. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * The optional account, inside Settings (PLAN.md 4b). Signed out: a short honest explanation and Google's button. Signed in: who you
 * are, Sign out (your pieces stay on this device) and Delete (removes the account and what is stored for it on Paun's server).
 * Shown only on request (`?accounts=1`) until Vault sync ships, so nobody signs in expecting something that is not there yet.
 */
export function AccountSection() {
  const { t, language } = useI18n();
  const account = useAccount();
  const sync = useSyncStatus();
  const now = useMinuteClock();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CopyKey | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setEnabled(accountsPreviewEnabled()), []);
  if (!enabled) return null;

  const onCredential = async (idToken: string) => {
    setBusy(true);
    setError(null);
    const r = await account.signIn(idToken);
    setBusy(false);
    if (!r.ok) setError(ERROR_COPY[r.error]);
  };
  const onDelete = async () => {
    setBusy(true);
    const r = await account.deleteAccount();
    setBusy(false);
    setConfirmDelete(false);
    if (r.ok) {
      clearSyncState(); // the next account to sign in on this device starts fresh
      resetSyncStatus();
      toast.success(t("acctDeleted"));
    }
    else setError(ERROR_COPY[r.error]);
  };

  return (
    <div className="space-y-2 rounded-md border p-3" data-testid="account-section">
      <div className="text-sm font-medium">{t("acctTitle")}</div>
      {account.status === "signedIn" ? (
        <>
          <div className="flex items-center gap-3">
            {account.user.image ? (
              <img src={account.user.image} alt="" width={36} height={36} referrerPolicy="no-referrer" className="h-9 w-9 rounded-full border" />
            ) : null}
            <div className="min-w-0 text-sm">
              <div className="text-xs text-muted-foreground">{t("acctSignedInAs")}</div>
              <div className="truncate font-medium">{account.user.name || account.user.email}</div>
              {account.user.name ? <div className="truncate text-xs text-muted-foreground">{account.user.email}</div> : null}
            </div>
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite" data-testid="sync-status">
            {sync.phase === "syncing"
              ? t("syncSyncing")
              : sync.phase === "failed" && sync.error
                ? t(SYNC_ERROR_COPY[sync.error])
                : sync.lastSyncAt
                  ? t("syncLast", { ago: formatAgo(sync.lastSyncAt, now, language), when: formatMoment(sync.lastSyncAt, language) })
                  : t("syncNotYet")}
            {sync.skipped > 0 ? ` ${t("syncSkipped", { n: sync.skipped })}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">{t("acctSignOutNote")}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy || sync.phase === "syncing"} onClick={() => syncNow()}>
              {t("syncNow")}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void account.signOut().then(() => toast(t("acctSignedOutToast")))}>
              {t("acctSignOut")}
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => setConfirmDelete(true)}>
              {t("acctDelete")}
            </Button>
          </div>
        </>
      ) : account.status === "unreachable" ? (
        <p className="text-xs text-muted-foreground">{t("acctOffline")}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t("acctHint")}</p>
          <p className="text-xs text-muted-foreground">{t("acctPrivacy")}</p>
          {busy ? <p className="text-sm">{t("acctSigningIn")}</p> : <GoogleSignInButton language={language} onCredential={(tok) => void onCredential(tok)} onUnavailable={() => setError("acctGoogleBlocked")} />}
        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {t(error)}
        </p>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("acctDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("acctDeleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void onDelete(); }}>
              {t("acctDeleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
