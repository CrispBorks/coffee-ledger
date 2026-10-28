import * as React from "react";
import { Link } from "react-router-dom";
import { PencilIcon, ScaleIcon, StarIcon } from "lucide-react";
import { toast } from "sonner";

import { BagFields } from "@/components/bag-fields";
import { Field, NumberField } from "@/components/form-section";
import { describeGear } from "@/components/gear-summary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { updateEntry, type Entry } from "@/lib/ledger";
import { bagOf, bagText, restPhaseOf, restText, shortDate, type RestPhase } from "@/lib/bags";
import { daysOffRoast, num, recipeOf } from "@/lib/shots";
import { cn } from "@/lib/utils";

/** "2026-10-12" → "Oct 12, 2026", read as a calendar day, not a UTC instant —
 *  which would show the 11th anywhere west of Greenwich. */
function roastDateText(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Finishing is reversible from a toast as well as from the page, because the
 *  button that does it sits right where a thumb rests. */
export function finishBag(entry: Entry) {
  updateEntry(entry.id, { finishedAt: Date.now() });
  toast(`${entry.coffee.trim() || "Coffee"} finished`, {
    action: { label: "Undo", onClick: () => updateEntry(entry.id, { finishedAt: null }) },
  });
}

/** The bag, folded down: it's entered once and read often, so it shows as a
 *  few lines — and opens into its fields only when something needs fixing.
 *  The shot log below it is what the page is for. */
export function CoffeeCard({ entry }: { entry: Entry }) {
  const [editing, setEditing] = React.useState(false);

  const facts = [entry.roaster, entry.origins, entry.process, entry.roastLevel]
    .map((v) => v.trim())
    .filter(Boolean);
  const day = daysOffRoast(entry.roastDate, Date.now());
  const phase = entry.finishedAt === null ? restPhaseOf(entry) : null;
  // The most recent starred shot: the recipe to go back to.
  const recipe = [...entry.shots].reverse().find((s) => s.starred);
  const gear = describeGear(entry);
  const empty =
    facts.length === 0 &&
    !entry.roastDate.trim() &&
    !entry.tastingNotes.trim() &&
    !entry.comments.trim() &&
    !entry.altitude.trim() &&
    !entry.variety.trim() &&
    !entry.bagGrams.trim();

  return (
    <section aria-label="About this coffee" className="rounded-md border border-border bg-card p-4 shadow-card">
      {editing ? (
        <CoffeeFields entry={entry} onDone={() => setEditing(false)} />
      ) : (
        <div className="flex flex-col gap-3">
          {/* Only the first line shares its row with the button; everything
              under it gets the card's full width, so the rest window and the
              recipe stay on one line on a phone. */}
          <div className="flex flex-col gap-1.5 text-[14px]">
            <div className="flex items-start gap-3">
              <p className={cn("min-w-0 flex-1 break-words", empty && "text-muted-foreground")}>
                {empty
                  ? "No details yet — roaster, origin, roast date, bag size."
                  : facts.join(" · ") || "No roaster or origin yet"}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="-mt-1 shrink-0"
                onClick={() => setEditing(true)}
                aria-label={empty ? "Add details" : "Edit details"}
              >
                <PencilIcon />
                <span className="hidden sm:inline">{empty ? "Add" : "Edit"}</span>
              </Button>
            </div>

            {!empty && (
              <>
                {(entry.roastDate.trim() || entry.altitude.trim() || entry.variety.trim()) && (
                  <p className="meta-mono text-muted-foreground">
                    {[
                      entry.roastDate.trim() &&
                        `Roasted ${roastDateText(entry.roastDate)}${day !== null ? ` · day ${day}` : ""}`,
                      entry.variety.trim(),
                      entry.altitude.trim() && `${entry.altitude.trim()} masl`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                {phase && <RestBadge phase={phase} />}
                {entry.tastingNotes.trim() && (
                  <p className="break-words text-muted-foreground italic">{entry.tastingNotes}</p>
                )}
                {entry.comments.trim() && <p className="break-words">{entry.comments}</p>}
              </>
            )}

            {recipe && (
              <p className="mt-1 flex items-start gap-1.5 font-mono text-[13px]">
                <StarIcon className="mt-0.5 size-3.5 shrink-0 fill-status text-status" />
                <span className="min-w-0 break-words">{recipeOf(recipe) || "Starred shot"}</span>
              </p>
            )}
            {gear && <p className="text-[12px] text-muted-foreground">On {gear}</p>}
          </div>

          <BagLine entry={entry} />
        </div>
      )}
    </section>
  );
}

/** Resting, in its window, or past its best — a status, so the one in the
 *  window is the one that gets the colour. */
export function RestBadge({ phase, className }: { phase: RestPhase; className?: string }) {
  return (
    <span
      className={cn(
        "w-fit rounded-full border px-2 py-0.5 font-mono text-[11px]",
        phase.phase === "window"
          ? "border-transparent bg-status text-status-foreground"
          : "border-border text-muted-foreground",
        className,
      )}
    >
      {restText(phase)}
    </span>
  );
}

/** Grams left, a way to correct them from the scale, and — once the count
 *  says it's empty — a question about finishing the bag. Never an automatic
 *  finish: the count only knows about the shots that were logged. */
function BagLine({ entry }: { entry: Entry }) {
  const [weighing, setWeighing] = React.useState(false);
  const [grams, setGrams] = React.useState("");
  const bag = bagOf(entry);
  const finished = entry.finishedAt !== null;

  if (finished) return null;

  const saveWeighIn = (event: React.FormEvent) => {
    event.preventDefault();
    if (num(grams) === null) return;
    updateEntry(entry.id, { weighedGrams: grams.trim(), weighedAt: Date.now() });
    setWeighing(false);
    setGrams("");
  };

  return (
    <div className="flex flex-col gap-2 border-t border-dotted border-border pt-3">
      {bag ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className={cn("font-mono text-[13px]", bag.low || bag.empty ? "text-foreground" : "text-muted-foreground")}>
            {entry.bagGrams.trim() && <>{entry.bagGrams.trim()}g bag · </>}
            <span className="text-foreground">{bagText(bag)}</span>
            {bag.low && <span className="font-medium"> · running low</span>}
          </p>
          {bag.weighed && entry.weighedAt !== null && (
            <span className="text-[12px] text-muted-foreground">
              weighed {shortDate(entry.weighedAt)}
            </span>
          )}
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">Not tracking how much is left.</p>
      )}

      {bag?.empty && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background/60 p-3">
          <p className="min-w-0 flex-1 text-[13px]">Looks like this bag is done.</p>
          <Button size="sm" onClick={() => finishBag(entry)}>
            Mark finished
          </Button>
        </div>
      )}

      {weighing ? (
        <form onSubmit={saveWeighIn} className="flex flex-col gap-2" aria-label="Weigh what's left">
          <div className="grid grid-cols-2 items-end gap-3">
            <NumberField
              label="On the scale"
              unit="g"
              value={grams}
              onChange={(event) => setGrams(event.target.value)}
              autoFocus
            />
            <div className="flex gap-2">
              <Button type="submit" className="h-11" disabled={num(grams) === null}>
                Save
              </Button>
              <Button type="button" variant="ghost" className="h-11" onClick={() => setWeighing(false)}>
                Cancel
              </Button>
            </div>
          </div>
          <p className="text-[12px] text-muted-foreground">
            Beans only, not the bag. Shots you log from now on count down from this.
          </p>
        </form>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <button
            type="button"
            onClick={() => setWeighing(true)}
            className="inline-flex items-center gap-1.5 py-1 text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            <ScaleIcon className="size-3.5" />
            {bag ? "Weigh it" : "Weigh what's left"}
          </button>
          {!bag?.empty && (
            <button
              type="button"
              onClick={() => finishBag(entry)}
              className="py-1 text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Finish bag
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Every detail of the bag, saved as you type — the same fields as Add Coffee. */
function CoffeeFields({ entry, onDone }: { entry: Entry; onDone: () => void }) {
  const set =
    (key: keyof Entry) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      updateEntry(entry.id, { [key]: event.target.value } as Partial<Entry>);

  const text = (label: string, key: keyof Entry, props: React.ComponentProps<"input"> = {}) => (
    <Field label={label}>
      {(id) => <Input id={id} value={entry[key] as string} onChange={set(key)} {...props} />}
    </Field>
  );

  return (
    <div className="flex flex-col gap-4">
      {text("Coffee", "coffee", { placeholder: "Kochere Natural" })}
      <div className="grid gap-4 sm:grid-cols-2">
        {text("Roaster", "roaster")}
        {text("Origin(s)", "origins")}
        {text("Process", "process")}
        {text("Roast level", "roastLevel")}
        {text("Roast date", "roastDate", { type: "date", className: "font-mono" })}
        {text("Variety", "variety")}
        {text("Altitude", "altitude", { inputMode: "numeric", placeholder: "masl", className: "font-mono" })}
      </div>
      <Field label="Tasting notes">
        {(id) => (
          <Textarea id={id} rows={2} value={entry.tastingNotes} onChange={set("tastingNotes")} />
        )}
      </Field>
      <Field label="Comments">
        {(id) => <Textarea id={id} rows={2} value={entry.comments} onChange={set("comments")} />}
      </Field>

      <div className="border-t border-dotted border-border pt-4">
        <BagFields values={entry} onChange={(patch) => updateEntry(entry.id, patch)} />
      </div>

      <p className="text-[12px] text-muted-foreground">
        Gear is recorded when a coffee is added.{" "}
        <Link to="/profile" className="underline underline-offset-2 hover:text-foreground">
          Your gear
        </Link>{" "}
        is set on your profile.
      </p>
      <div>
        <Button className="h-11 px-5" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
