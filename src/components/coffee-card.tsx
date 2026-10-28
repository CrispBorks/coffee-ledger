import * as React from "react";
import { Link } from "react-router-dom";
import { PencilIcon, StarIcon } from "lucide-react";

import { Field } from "@/components/form-section";
import { describeGear } from "@/components/gear-summary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { updateEntry, type Entry } from "@/lib/ledger";
import { daysOffRoast, recipeOf } from "@/lib/shots";

/** "2026-10-12" → "Oct 12", read as a calendar day, not a UTC instant — which
 *  would show the 11th anywhere west of Greenwich. */
function roastDateText(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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
  // The most recent starred shot: the recipe to go back to.
  const recipe = [...entry.shots].reverse().find((s) => s.starred);
  const gear = describeGear(entry);
  const empty =
    facts.length === 0 &&
    !entry.roastDate.trim() &&
    !entry.tastingNotes.trim() &&
    !entry.comments.trim() &&
    !entry.altitude.trim() &&
    !entry.variety.trim();

  return (
    <section aria-label="About this coffee" className="rounded-md border border-border bg-card p-4 shadow-card">
      {editing ? (
        <CoffeeFields entry={entry} onDone={() => setEditing(false)} />
      ) : (
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-[14px]">
            {empty ? (
              <p className="text-muted-foreground">No details yet — roaster, origin, roast date.</p>
            ) : (
              <>
                {facts.length > 0 && <p className="break-words">{facts.join(" · ")}</p>}
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

          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setEditing(true)}
            aria-label={empty ? "Add details" : "Edit details"}
          >
            <PencilIcon />
            {empty ? "Add" : "Edit"}
          </Button>
        </div>
      )}
    </section>
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
