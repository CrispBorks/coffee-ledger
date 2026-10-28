import * as React from "react";
import { AlertTriangleIcon, CloudOffIcon, LoaderIcon, RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { dismissLegacy, importLegacy, loadLedger, retryFailed, useLedger } from "@/lib/ledger";

/** The one piece of chrome the database added: a corner that says whether what
 *  you just typed is anywhere but this screen.
 *
 *  Silent when everything has landed, which is nearly always — the point is
 *  that saving is not a button you press, so the only thing worth showing is
 *  when it hasn't worked. Rendered by PageShell, so it's on every page. */
export function LedgerStatus() {
  const { saving, unsaved, failed, writeError, offline } = useLedger();

  // Offline with nothing waiting is worth a quiet word, not an alarm: what's
  // on screen is this device's copy, and anything logged will follow.
  if (offline && failed === 0 && writeError === "" && !(saving && unsaved > 0)) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="no-print fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex max-w-[min(26rem,calc(100vw-2rem))] items-center gap-2 rounded-md border border-border bg-card px-3 py-2 shadow-card"
      >
        <CloudOffIcon className="size-4 shrink-0 text-muted-foreground" />
        <p className="text-[13px] leading-snug">Offline · showing what's saved on this device</p>
      </div>
    );
  }

  if (failed === 0 && writeError === "" && !(saving && unsaved > 0)) return null;
  const wrong = failed > 0 || writeError !== "";

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 max-w-[min(26rem,calc(100vw-2rem))] rounded-md border border-border bg-card px-3 py-2.5 shadow-card"
    >
      <div className="flex items-start gap-2.5">
        {wrong ? (
          <AlertTriangleIcon className="mt-px size-4 shrink-0 text-destructive" />
        ) : (
          <LoaderIcon className="mt-px size-4 shrink-0 animate-spin text-muted-foreground" />
        )}

        <div className="min-w-0">
          <p className="text-[13px] leading-snug">
            {failed > 0
              ? `${failed} change${failed === 1 ? "" : "s"} not saved`
              : writeError !== ""
                ? "That change wasn't saved"
                : "Saving…"}
          </p>
          {writeError !== "" && (
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{writeError}</p>
          )}
        </div>

        {failed > 0 && (
          <Button size="sm" variant="outline" className="shrink-0" onClick={retryFailed}>
            <RefreshCwIcon />
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

/** Shown in place of the ledger when the first read didn't come back. There's
 *  nothing to show underneath it — an empty grid here would read as "you have
 *  no coffees", which is the one thing we don't know. */
export function LedgerUnreachable({ error }: { error: string }) {
  const [busy, setBusy] = React.useState(false);

  return (
    <div className="rounded-md border border-dashed border-destructive/50 p-8 text-center">
      <CloudOffIcon className="mx-auto size-5 text-muted-foreground" />
      <p className="mt-3 text-[15px]">The ledger couldn't be loaded.</p>
      <p className="mx-auto mt-2 max-w-[52ch] text-[13px] text-muted-foreground">{error}</p>
      <Button
        variant="outline"
        size="sm"
        className="mt-4"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await loadLedger(true);
          setBusy(false);
        }}
      >
        <RefreshCwIcon />
        Try again
      </Button>
    </div>
  );
}

/** Offered once, at the top of the ledger, when this browser still holds the
 *  coffees it saved before there was a database. Importing copies them up and
 *  keeps the local copy under a second key rather than deleting it. */
export function LegacyImportBanner() {
  const { legacy, status } = useLedger();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  if (legacy === 0 || status !== "ready") return null;

  return (
    <div className="no-print mb-5 rounded-md border border-border bg-card p-4">
      <p className="text-[14px]">
        {legacy} {legacy === 1 ? "coffee is" : "coffees are"} saved in this browser from
        before the ledger had a database.
      </p>
      <p className="mt-1.5 max-w-[62ch] text-[13px] text-muted-foreground">
        Importing copies {legacy === 1 ? "it" : "them"} into the database so every device
        sees {legacy === 1 ? "it" : "them"}. The browser's copy is kept either way.
      </p>
      {error !== "" && <p className="mt-2 text-[13px] text-destructive">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            const result = await importLegacy();
            setBusy(false);
            if (result.error) {
              setError(
                result.imported > 0
                  ? `Imported ${result.imported} before stopping: ${result.error}`
                  : result.error,
              );
            }
          }}
        >
          {busy ? "Importing…" : "Import into the database"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={dismissLegacy}>
          Don't ask again
        </Button>
      </div>
    </div>
  );
}
