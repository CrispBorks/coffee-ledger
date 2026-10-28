import { Link } from "react-router-dom";

import { GEAR_FIELDS, type GearField } from "@/lib/ledger";

/** "Decent DE1 · Niche Zero · VST 18g" — the gear that's filled in, in the
 *  order it's set up, or "" when none of it is. */
export function describeGear(gear: Record<GearField, string>): string {
  return GEAR_FIELDS.map((field) => gear[field].trim())
    .filter(Boolean)
    .join(" · ");
}

/** Where gear used to be a form, a line saying which gear a coffee is (or will
 *  be) pulled on, and where to change it. */
export function GearSummary({
  gear,
  lead,
  empty,
}: {
  gear: Record<GearField, string>;
  /** Shown before the gear, e.g. "Added with". */
  lead: string;
  /** Shown instead when there's no gear at all. */
  empty: string;
}) {
  const line = describeGear(gear);

  return (
    <p className="text-[13px] leading-relaxed text-muted-foreground">
      {line ? (
        <>
          {lead} <span className="text-foreground">{line}</span>.{" "}
        </>
      ) : (
        <>{empty} </>
      )}
      <Link
        to="/profile"
        className="whitespace-nowrap underline underline-offset-2 hover:text-foreground"
      >
        {line ? "Change in your profile" : "Set it up in your profile"}
      </Link>
    </p>
  );
}
