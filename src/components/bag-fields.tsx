import * as React from "react";

import { NumberField } from "@/components/form-section";
import type { Entry } from "@/lib/ledger";
import { dayAfter, REST_DEFAULTS, roastBandOf, restWindowOf, shortDate } from "@/lib/bags";
import { cn } from "@/lib/utils";

type BagValues = Pick<Entry, "bagGrams" | "restFrom" | "restTo" | "roastLevel" | "roastDate">;

/** The usual bag sizes, so most bags are one tap. */
const SIZES = [
  { grams: "250", label: "250g" },
  { grams: "340", label: "340g" },
  { grams: "500", label: "500g" },
  { grams: "1000", label: "1kg" },
];

const BAND_NAMES = { light: "Light roast", medium: "Medium roast", dark: "Dark roast" } as const;

/** The bag's size and its rest window — on Add Coffee, and when editing a
 *  coffee's details. The window is shown as dates you can act on ("ready
 *  Oct 26"), worked out from the roast level and date, and only becomes two
 *  number boxes if you choose to adjust it. */
export function BagFields({
  values,
  onChange,
}: {
  values: BagValues;
  onChange: (patch: Partial<Pick<Entry, "bagGrams" | "restFrom" | "restTo">>) => void;
}) {
  const customised = values.restFrom.trim() !== "" || values.restTo.trim() !== "";
  const [adjusting, setAdjusting] = React.useState(customised);

  const band = roastBandOf(values.roastLevel);
  const defaults = REST_DEFAULTS[band];
  const window = restWindowOf(values);
  const ready = dayAfter(values.roastDate, window.from);
  const until = dayAfter(values.roastDate, window.to);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div role="group" aria-label="Common bag sizes" className="grid grid-cols-4 gap-2">
          {SIZES.map((size) => {
            const chosen = values.bagGrams.trim() === size.grams;
            return (
              <button
                key={size.grams}
                type="button"
                aria-pressed={chosen}
                onClick={() => onChange({ bagGrams: chosen ? "" : size.grams })}
                className={cn(
                  "label-mono h-11 rounded-md border transition-colors",
                  "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
                  chosen
                    ? "border-foreground bg-foreground text-background"
                    : "border-input bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {size.label}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Bag size"
            unit="g"
            value={values.bagGrams}
            onChange={(event) => onChange({ bagGrams: event.target.value })}
            placeholder="250"
          />
        </div>
        <p className="text-[12px] text-muted-foreground">
          Grams left count down as you log shots. Leave it blank to not track this bag.
        </p>
      </div>

      <div className="flex flex-col gap-2" aria-live="polite">
        <span className="label-mono text-muted-foreground">Rest window</span>
        <p className="text-[14px]">
          {ready && until ? (
            <>
              Ready <span className="font-medium">{shortDate(ready)}</span> · best until{" "}
              <span className="font-medium">{shortDate(until)}</span>
            </>
          ) : (
            <>
              Ready from day {window.from}, best until day {window.to}
            </>
          )}
        </p>
        <p className="text-[12px] text-muted-foreground">
          {window.source === "set"
            ? `Set for this bag: day ${window.from} to ${window.to} off roast.`
            : `${BAND_NAMES[band]}: day ${defaults.from} to ${defaults.to} off roast.`}
          {!values.roastDate.trim() && " Add the roast date to see the dates."}
        </p>

        {adjusting ? (
          <div className="mt-1 flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Ready from day"
                value={values.restFrom}
                placeholder={String(defaults.from)}
                onChange={(event) => onChange({ restFrom: event.target.value })}
              />
              <NumberField
                label="Best until day"
                value={values.restTo}
                placeholder={String(defaults.to)}
                onChange={(event) => onChange({ restTo: event.target.value })}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                onChange({ restFrom: "", restTo: "" });
                setAdjusting(false);
              }}
              className="self-start py-1 text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Use the {BAND_NAMES[band].toLowerCase()} default
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdjusting(true)}
            className="self-start py-1 text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Adjust for this bag
          </button>
        )}
      </div>
    </div>
  );
}
