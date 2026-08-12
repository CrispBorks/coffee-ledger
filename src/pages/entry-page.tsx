import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PlusIcon, StarIcon, Trash2Icon } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { BackLink, PageShell, SiteFooter } from "@/components/page-shell";
import {
  addShot,
  deleteEntry,
  deleteShot,
  updateEntry,
  updateShot,
  useEntry,
  type Entry,
  type Shot,
} from "@/lib/ledger";
import { cn } from "@/lib/utils";

export function EntryPage() {
  const { id } = useParams<{ id: string }>();
  const entry = useEntry(id);
  const navigate = useNavigate();

  React.useEffect(() => {
    document.title = entry ? `${entry.coffee || "Coffee"} — Coffee Ledger` : "Coffee Ledger";
  }, [entry]);

  if (!id) return null;

  if (!entry) {
    return (
      <PageShell width="reading">
        <div className="no-print pt-9 pb-5">
          <BackLink />
        </div>
        <p className="rounded-md border border-dashed border-border p-8 text-center text-[15px] text-muted-foreground">
          That coffee isn't in the ledger.{" "}
          <Link to="/" className="underline underline-offset-2">
            Back to the ledger.
          </Link>
        </p>
        <SiteFooter />
      </PageShell>
    );
  }

  const set = (key: keyof Entry) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => updateEntry(entry.id, { [key]: e.target.value } as Partial<Entry>);

  const onDelete = () => {
    deleteEntry(entry.id);
    toast.success("Removed from the ledger");
    navigate("/");
  };

  return (
    <PageShell>
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

      <input
        value={entry.coffee}
        onChange={set("coffee")}
        placeholder="Untitled coffee"
        aria-label="Coffee name"
        className="display w-full bg-transparent text-[32px] leading-[1.1] font-semibold text-balance outline-none placeholder:text-muted-foreground/50 sm:text-[38px]"
      />

      <section className="mt-8 grid gap-x-6 gap-y-6 sm:grid-cols-3">
        <div className="flex flex-col gap-4">
          <LabeledInput label="Roaster" value={entry.roaster} onChange={set("roaster")} placeholder="—" />
          <LabeledInput label="Origin(s)" value={entry.origins} onChange={set("origins")} placeholder="—" />
          <LabeledInput
            label="Altitude"
            value={entry.altitude}
            onChange={set("altitude")}
            placeholder="—"
            suffix="MASL"
            mono
          />
          <LabeledTextarea
            label="Tasting notes"
            value={entry.tastingNotes}
            onChange={set("tastingNotes")}
            placeholder="—"
          />
        </div>

        <div className="flex flex-col gap-4">
          <LabeledInput label="Roast level" value={entry.roastLevel} onChange={set("roastLevel")} placeholder="—" />
          <LabeledInput
            label="Roast date"
            type="date"
            value={entry.roastDate}
            onChange={set("roastDate")}
            mono
          />
          <LabeledInput label="Process" value={entry.process} onChange={set("process")} placeholder="—" />
          <LabeledInput label="Variety" value={entry.variety} onChange={set("variety")} placeholder="—" />
          <LabeledTextarea label="Comments" value={entry.comments} onChange={set("comments")} placeholder="—" />
        </div>

        <div className="flex flex-col gap-4">
          <LabeledInput label="Machine" value={entry.machine} onChange={set("machine")} placeholder="—" />
          <LabeledInput label="Grinder" value={entry.grinder} onChange={set("grinder")} placeholder="—" />
          <LabeledInput label="Basket" value={entry.basket} onChange={set("basket")} placeholder="—" />
          <LabeledInput label="Other" value={entry.other} onChange={set("other")} placeholder="—" />
        </div>
      </section>

      <section className="mt-10">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
          <h2 className="label-mono text-muted-foreground">Shot log</h2>
          <Button
            variant="outline"
            size="sm"
            className="no-print"
            onClick={() => addShot(entry.id)}
          >
            <PlusIcon />
            Add shot
          </Button>
        </div>

        {entry.shots.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-border p-6 text-center text-[14px] text-muted-foreground">
            No shots logged yet. Pull one and add it below.
          </p>
        ) : (
          <div className="mt-4 -mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[880px] border-collapse">
              <thead>
                <tr className="label-mono text-muted-foreground">
                  <Th className="w-9 pl-1">
                    <StarIcon className="size-3.5" />
                  </Th>
                  <Th>Grind</Th>
                  <Th>Dose</Th>
                  <Th>Yield</Th>
                  <Th>Time</Th>
                  <Th>RPM</Th>
                  <Th>Temp</Th>
                  <Th>Infusion</Th>
                  <Th className="text-center">PS</Th>
                  <Th className="w-32">Extraction</Th>
                  <Th className="min-w-[140px]">Notes</Th>
                  <Th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {entry.shots.map((shot) => (
                  <ShotRow key={shot.id} entryId={entry.id} shot={shot} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <SiteFooter />
    </PageShell>
  );
}

function ShotRow({ entryId, shot }: { entryId: string; shot: Shot }) {
  const set = (key: keyof Shot) => (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => updateShot(entryId, shot.id, { [key]: e.target.value } as Partial<Shot>);

  return (
    <tr className="border-b border-dotted border-border last:border-b-0">
      <Td className="pl-1">
        <button
          type="button"
          aria-pressed={shot.starred}
          aria-label={shot.starred ? "Unstar this shot" : "Mark as a best shot"}
          onClick={() => updateShot(entryId, shot.id, { starred: !shot.starred })}
          className="grid size-7 place-items-center rounded-md transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <StarIcon
            className={cn(
              "size-4",
              shot.starred ? "fill-status text-status" : "text-muted-foreground",
            )}
          />
        </button>
      </Td>
      <Td>
        <CellInput value={shot.grind} onChange={set("grind")} aria-label="Grind" />
      </Td>
      <Td>
        <CellInput value={shot.dose} onChange={set("dose")} aria-label="Dose" suffix="g" />
      </Td>
      <Td>
        <CellInput value={shot.yield} onChange={set("yield")} aria-label="Yield" suffix="g" />
      </Td>
      <Td>
        <div className="flex items-center gap-0.5">
          <CellInput
            value={shot.timeMin}
            onChange={set("timeMin")}
            aria-label="Minutes"
            className="w-7"
          />
          <span className="meta-mono text-muted-foreground">:</span>
          <CellInput
            value={shot.timeSec}
            onChange={set("timeSec")}
            aria-label="Seconds"
            className="w-7"
          />
        </div>
      </Td>
      <Td>
        <CellInput value={shot.rpm} onChange={set("rpm")} aria-label="RPM" />
      </Td>
      <Td>
        <CellInput value={shot.temp} onChange={set("temp")} aria-label="Temperature" suffix="°" />
      </Td>
      <Td>
        <CellInput value={shot.infusion} onChange={set("infusion")} aria-label="Infusion" suffix="s" />
      </Td>
      <Td className="text-center">
        <Checkbox
          checked={shot.ps}
          onCheckedChange={(checked) =>
            updateShot(entryId, shot.id, { ps: checked === true })
          }
          aria-label="Pre-soak"
        />
      </Td>
      <Td>
        <div className="flex items-center gap-1.5">
          <span className="meta-mono text-muted-foreground">U</span>
          <input
            type="range"
            min={0}
            max={100}
            value={shot.extraction}
            onChange={(e) =>
              updateShot(entryId, shot.id, { extraction: Number(e.target.value) })
            }
            aria-label="Extraction, under to over"
            className="h-1 w-full cursor-pointer accent-foreground"
          />
          <span className="meta-mono text-muted-foreground">O</span>
        </div>
      </Td>
      <Td>
        <input
          value={shot.notes}
          onChange={set("notes")}
          placeholder="—"
          aria-label="Notes"
          className="w-full min-w-[120px] bg-transparent px-1 py-1 text-[13px] outline-none placeholder:text-muted-foreground/50 focus-visible:rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring/40"
        />
      </Td>
      <Td>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
          aria-label="Delete shot"
          onClick={() => deleteShot(entryId, shot.id)}
        >
          <Trash2Icon className="size-3.5" />
        </Button>
      </Td>
    </tr>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("py-2 pr-2 text-left font-normal", className)}>{children}</th>;
}

function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("py-1 pr-2 align-middle", className)}>{children}</td>;
}

function CellInput({
  className,
  suffix,
  ...props
}: React.ComponentProps<"input"> & { suffix?: string }) {
  return (
    <div className="flex items-center gap-1">
      <input
        {...props}
        className={cn(
          "meta-mono w-14 min-w-0 bg-transparent px-1 py-1 outline-none placeholder:text-muted-foreground/50 focus-visible:rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring/40",
          className,
        )}
      />
      {suffix && <span className="meta-mono text-muted-foreground">{suffix}</span>}
    </div>
  );
}

function LabeledInput({
  label,
  suffix,
  mono,
  className,
  ...props
}: React.ComponentProps<"input"> & { label: string; suffix?: string; mono?: boolean }) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="label-mono text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-1.5 border-b border-dotted border-border pb-1">
        <input
          id={id}
          {...props}
          className={cn(
            "w-full bg-transparent text-[14px] outline-none placeholder:text-muted-foreground/50",
            mono && "font-mono",
            className,
          )}
        />
        {suffix && <span className="meta-mono shrink-0 text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

function LabeledTextarea({
  label,
  className,
  ...props
}: React.ComponentProps<"textarea"> & { label: string }) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="label-mono text-muted-foreground">
        {label}
      </Label>
      <Textarea
        id={id}
        rows={2}
        {...props}
        className={cn(
          "border-0 border-b border-dotted border-border bg-transparent px-0 pb-1 text-[14px] shadow-none focus-visible:ring-0",
          className,
        )}
      />
    </div>
  );
}

export function EntrySkeleton() {
  return (
    <PageShell>
      <div className="pt-9 pb-5">
        <BackLink />
      </div>
      <Skeleton className="h-9 w-3/4" />
      <div className="mt-8 grid gap-6 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    </PageShell>
  );
}
