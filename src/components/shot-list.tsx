import * as React from "react";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { ShotFields, StarToggle, formOf, shotPatchOf, type ShotForm } from "@/components/shot-composer";
import { Button } from "@/components/ui/button";
import { deleteShot, restoreShot, updateShot, type Entry, type Shot } from "@/lib/ledger";
import { agoText, changesFrom, daysOffRoast, ratioOf, secondsOf, tasteOf } from "@/lib/shots";
import { cn } from "@/lib/utils";

/** Every shot of one coffee, newest first — the one you just pulled is the one
 *  you want to compare against. Numbered in the order they were pulled, so a
 *  new shot doesn't renumber the rest. */
export function ShotList({ entry }: { entry: Entry }) {
  const [editing, setEditing] = React.useState<string | null>(null);
  // The log is kept in pull order; shown newest first.
  const newestFirst = entry.shots.map((shot, index) => ({ shot, index })).reverse();

  const remove = (shot: Shot, number: number) => {
    const removed = deleteShot(entry.id, shot.id);
    if (editing === shot.id) setEditing(null);
    if (!removed) return;
    toast(`Shot #${number} deleted`, {
      action: { label: "Undo", onClick: () => restoreShot(entry.id, removed) },
    });
  };

  return (
    <ol className="flex flex-col gap-3">
      {newestFirst.map(({ shot, index }) => (
        <li key={shot.id}>
          <ShotCard
            entry={entry}
            shot={shot}
            number={index + 1}
            previous={index > 0 ? entry.shots[index - 1] : undefined}
            editing={editing === shot.id}
            onEdit={() => setEditing(editing === shot.id ? null : shot.id)}
            onDelete={() => remove(shot, index + 1)}
          />
        </li>
      ))}
    </ol>
  );
}

function ShotCard({
  entry,
  shot,
  number,
  previous,
  editing,
  onEdit,
  onDelete,
}: {
  entry: Entry;
  shot: Shot;
  number: number;
  previous?: Shot;
  editing: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const day = daysOffRoast(entry.roastDate, shot.pulledAt);
  const taste = tasteOf(shot.extraction);
  const ratio = ratioOf(shot.dose, shot.yield);
  const seconds = secondsOf(shot);
  const changes = previous ? changesFrom(previous, shot) : [];

  // Editing saves as you type, like every other field already logged.
  const change = (patch: Partial<ShotForm>) => updateShot(entry.id, shot.id, shotPatchOf(patch));

  const details = [
    shot.grind.trim() && `grind ${shot.grind.trim()}`,
    shot.infusion.trim() && `pre-infusion ${shot.infusion.trim()}s`,
    shot.temp.trim() && `${shot.temp.trim()}°C`,
    shot.rpm.trim() && `${shot.rpm.trim()} rpm`,
  ].filter(Boolean);

  return (
    <article
      aria-label={`Shot #${number}`}
      className={cn(
        "rounded-md border bg-card p-3.5 shadow-card",
        editing ? "border-foreground/25" : "border-border",
      )}
    >
      {/* Number over time, not beside it: on a phone the three buttons take
          most of the row, and "day 16" is worth more than a truncation. */}
      <header className="flex items-center gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="label-mono text-foreground">#{number}</span>
          {/* Each part kept whole, so a narrow row breaks at the dot rather
              than between "day" and its number. */}
          <span className="meta-mono text-muted-foreground">
            <span className="whitespace-nowrap">{agoText(shot.pulledAt)}</span>
            {day !== null && (
              <>
                {" · "}
                <span className="whitespace-nowrap">day {day}</span>
              </>
            )}
          </span>
        </div>
        <div className="ml-auto flex shrink-0 items-center">
          <StarToggle
            starred={shot.starred}
            onToggle={() => updateShot(entry.id, shot.id, { starred: !shot.starred })}
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label={editing ? `Done editing shot #${number}` : `Edit shot #${number}`}
            aria-pressed={editing}
            onClick={onEdit}
          >
            <PencilIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 text-muted-foreground hover:text-destructive"
            aria-label={`Delete shot #${number}`}
            onClick={onDelete}
          >
            <Trash2Icon className="size-4" />
          </Button>
        </div>
      </header>

      {editing ? (
        <div className="mt-3">
          <ShotFields form={formOf(shot)} onChange={change} />
          <Button className="mt-4 h-11 px-5" onClick={onEdit}>
            Done
          </Button>
        </div>
      ) : (
        <div className="mt-1.5 flex flex-col gap-1.5">
          <p className="display text-[19px] leading-snug font-semibold">
            {shot.dose.trim() || shot.yield.trim() ? (
              <>
                {shot.dose.trim() ? `${shot.dose.trim()}g` : "?"}
                <span className="text-muted-foreground"> → </span>
                {shot.yield.trim() ? `${shot.yield.trim()}g` : "?"}
              </>
            ) : (
              <span className="text-muted-foreground">No weights</span>
            )}
            {(ratio || seconds !== null) && (
              <span className="font-mono text-[14px] font-normal text-muted-foreground">
                {ratio && ` · ${ratio}`}
                {seconds !== null && ` · ${seconds}s`}
              </span>
            )}
          </p>

          {(details.length > 0 || taste) && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
              {details.length > 0 && <span>{details.join(" · ")}</span>}
              {taste && (
                <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-foreground">
                  {taste.label}
                </span>
              )}
            </p>
          )}

          {shot.notes.trim() && <p className="text-[14px] break-words">{shot.notes}</p>}

          {/* Wraps between changes, never inside one: non-breaking spaces hold
              "grind 3.4 → 3.2" together, the " · " between them is where a line
              can break, and overflow-wrap catches a value too long for a phone. */}
          {changes.length > 0 && (
            <p className="font-mono text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
              vs #{number - 1}:{" "}
              {changes.map((c, i) => (
                <React.Fragment key={c.label}>
                  {i > 0 && " · "}
                  {`${c.label}\u00a0${c.from}\u00a0→\u00a0`}
                  <span className="text-foreground">{c.to}</span>
                </React.Fragment>
              ))}
            </p>
          )}
        </div>
      )}
    </article>
  );
}
