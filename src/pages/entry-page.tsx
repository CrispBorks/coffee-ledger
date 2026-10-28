import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CoffeeCard } from "@/components/coffee-card";
import { LedgerUnreachable } from "@/components/ledger-status";
import { BackLink, PageShell, SiteFooter } from "@/components/page-shell";
import { ShotComposer, readDraft } from "@/components/shot-composer";
import { ShotList } from "@/components/shot-list";
import { finishedText } from "@/lib/bags";
import { deleteEntry, updateEntry, useEntry, useLedger } from "@/lib/ledger";

export function EntryPage() {
  const { id } = useParams<{ id: string }>();
  const entry = useEntry(id);
  const { status, loadError } = useLedger();
  const navigate = useNavigate();
  // Open on arrival only if a shot was half-typed here and left; otherwise the
  // shots you've already pulled are the first thing you see.
  const [composing, setComposing] = React.useState(() => (id ? readDraft(id) !== null : false));

  React.useEffect(() => {
    document.title = entry ? `${entry.coffee || "Coffee"} — Coffee Ledger` : "Coffee Ledger";
  }, [entry]);

  if (!id) return null;

  // A deep link opens before the read comes back, so "not in the ledger" has
  // to wait until we've actually looked — otherwise every shared URL flashes a
  // 404 on the way in.
  if (!entry && status === "loading") return <EntrySkeleton />;

  if (!entry) {
    return (
      <PageShell width="reading">
        <div className="no-print pt-9 pb-5">
          <BackLink />
        </div>
        {status === "unreachable" ? (
          <LedgerUnreachable error={loadError} />
        ) : (
          <p className="rounded-md border border-dashed border-border p-8 text-center text-[15px] text-muted-foreground">
            That coffee isn't in the ledger.{" "}
            <Link to="/" className="underline underline-offset-2">
              Back to the ledger.
            </Link>
          </p>
        )}
        <SiteFooter />
      </PageShell>
    );
  }

  const finished = entry.finishedAt !== null;

  const onDelete = () => {
    deleteEntry(entry.id);
    toast.success("Removed from the ledger");
    navigate("/");
  };

  return (
    <PageShell width="reading">
      <div className="no-print flex items-center justify-between gap-3 pt-9 pb-5">
        <BackLink />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete coffee"
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2Icon />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this coffee from the ledger?</AlertDialogTitle>
              <AlertDialogDescription>
                This deletes the coffee info and every logged shot for it. This can't
                be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <h1 className="display text-[30px] leading-[1.1] font-semibold text-balance break-words sm:text-[36px]">
        {entry.coffee.trim() || "Untitled coffee"}
      </h1>

      {/* A finished bag keeps everything — the point is the record of what
          worked — but stops taking new shots unless it's reopened. */}
      {finished && (
        <div
          role="status"
          className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/50 p-3"
        >
          <p className="min-w-0 flex-1 text-[14px]">{finishedText(entry)}</p>
          <Button variant="outline" size="sm" onClick={() => updateEntry(entry.id, { finishedAt: null })}>
            Reopen
          </Button>
        </div>
      )}

      <div className="mt-4">
        <CoffeeCard entry={entry} />
      </div>

      <section aria-label="Shots" className="mt-8">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
          <h2 className="label-mono text-muted-foreground">
            Shots{entry.shots.length > 0 && ` · ${entry.shots.length}`}
          </h2>
          {!composing && !finished && (
            <Button className="no-print h-10" onClick={() => setComposing(true)}>
              <PlusIcon />
              Log shot
            </Button>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {composing && !finished && (
            <ShotComposer
              entryId={entry.id}
              number={entry.shots.length + 1}
              onClose={() => setComposing(false)}
            />
          )}

          {entry.shots.length === 0
            ? !composing && (
                <p className="rounded-md border border-dashed border-border p-6 text-center text-[14px] text-muted-foreground">
                  {finished ? "No shots were logged on this bag." : "No shots yet. Pull one, then log it here."}
                </p>
              )
            : <ShotList entry={entry} />}
        </div>
      </section>

      <SiteFooter />
    </PageShell>
  );
}

export function EntrySkeleton() {
  return (
    <PageShell width="reading">
      <div className="pt-9 pb-5">
        <BackLink />
      </div>
      <Skeleton className="h-9 w-3/4" />
      <Skeleton className="mt-4 h-24 w-full" />
      <div className="mt-8 flex flex-col gap-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    </PageShell>
  );
}
