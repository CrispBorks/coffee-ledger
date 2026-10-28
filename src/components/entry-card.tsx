import { Link } from "react-router-dom";
import { StarIcon } from "lucide-react";

import { RestBadge } from "@/components/coffee-card";
import { Badge } from "@/components/ui/badge";
import { bagOf, bagText, finishedText, restPhaseOf } from "@/lib/bags";
import { bestShots, type Entry } from "@/lib/ledger";
import { recipeOf } from "@/lib/shots";
import { cn } from "@/lib/utils";

/** One bag in the ledger. In use, it answers "how much is left, and is it
 *  ready?"; finished, it's the record — how it went and what worked. */
export function EntryCard({ entry }: { entry: Entry }) {
  const meta = [entry.roaster, entry.roastDate].filter(Boolean);
  const tags = [entry.roastLevel, entry.process, entry.origins].filter(Boolean);
  const starred = bestShots(entry).length;
  const finished = entry.finishedAt !== null;
  const phase = finished ? null : restPhaseOf(entry);
  const bag = finished ? null : bagOf(entry);
  const recipe = [...entry.shots].reverse().find((s) => s.starred);

  return (
    <Link
      to={`/entry/${entry.id}`}
      className="group relative flex flex-col gap-2.5 rounded-md border border-border bg-card py-3.5 pr-4 pl-8 shadow-card transition-colors hover:border-foreground/35 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      {/* Punch hole, like a real ledger card. */}
      <span
        aria-hidden
        className="absolute top-4 left-3 size-2 rounded-full border border-border bg-background"
      />

      <div className="flex items-start justify-between gap-2">
        <h3 className="display text-[17px] leading-tight font-semibold">
          {entry.coffee || "Untitled coffee"}
        </h3>
        {starred > 0 && (
          <span className="meta-mono flex shrink-0 items-center gap-1 text-status-foreground">
            <StarIcon className="size-3.5 fill-status text-status" />
            {starred}
          </span>
        )}
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.slice(0, 3).map((tag, i) => (
            <Badge key={`${tag}-${i}`}>{tag}</Badge>
          ))}
        </div>
      )}

      {meta.length > 0 && (
        <p className="meta-mono text-muted-foreground">{meta.join(" · ")}</p>
      )}

      {phase && <RestBadge phase={phase} />}

      {finished ? (
        <>
          <p className="meta-mono text-muted-foreground">{finishedText(entry)}</p>
          {recipe && recipeOf(recipe) && (
            <p className="flex items-start gap-1.5 font-mono text-[12px]">
              <StarIcon className="mt-0.5 size-3 shrink-0 fill-status text-status" />
              <span className="min-w-0 break-words">{recipeOf(recipe)}</span>
            </p>
          )}
        </>
      ) : (
        <p className="meta-mono text-muted-foreground">
          {entry.shots.length} shot{entry.shots.length === 1 ? "" : "s"} logged
          {bag && (
            <span className={cn((bag.low || bag.empty) && "text-foreground")}>
              {" · "}
              {/* Short on a small card: the coffee's page has the full story. */}
              {bag.empty ? `${Math.round(bag.left)}g left · done?` : bagText(bag)}
              {!bag.empty && bag.low && " · running low"}
            </span>
          )}
        </p>
      )}
    </Link>
  );
}
