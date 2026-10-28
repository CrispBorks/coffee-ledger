import * as React from "react";
import { ChevronDownIcon, StarIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addShot, type Shot } from "@/lib/ledger";
import { ratioOf, tasteOf, TASTES, timeFieldOf, withSeconds } from "@/lib/shots";
import { cn } from "@/lib/utils";

/** A shot as the form holds it: time is one seconds box rather than the
 *  minutes/seconds pair it's stored as. */
export type ShotForm = {
  grind: string;
  dose: string;
  yield: string;
  time: string;
  infusion: string;
  ps: boolean;
  notes: string;
  temp: string;
  rpm: string;
  extraction: number | null;
  starred: boolean;
};

export const EMPTY_FORM: ShotForm = {
  grind: "",
  dose: "",
  yield: "",
  time: "",
  infusion: "",
  ps: false,
  notes: "",
  temp: "",
  rpm: "",
  extraction: null,
  starred: false,
};

export function formOf(shot: Shot): ShotForm {
  return {
    grind: shot.grind,
    dose: shot.dose,
    yield: shot.yield,
    time: timeFieldOf(shot),
    infusion: shot.infusion,
    ps: shot.ps,
    notes: shot.notes,
    temp: shot.temp,
    rpm: shot.rpm,
    extraction: shot.extraction,
    starred: shot.starred,
  };
}

/** Form fields back into what's stored. Only the fields in `patch` are
 *  returned, so an edit to one box writes one field. */
export function shotPatchOf(patch: Partial<ShotForm>): Partial<Shot> {
  const { time, ...rest } = patch;
  return time === undefined ? rest : { ...rest, ...withSeconds(time) };
}

const isBlank = (form: ShotForm) =>
  Object.entries(form).every(([key, value]) =>
    key === "extraction" ? value === null : value === "" || value === false,
  );

/* ----------------------------------------------------------------- storage */

/** Where a half-typed shot waits, per coffee, so a reload or a locked phone
 *  between pulling and typing doesn't lose it. */
const draftKey = (entryId: string) => `coffeeLedger.draft.${entryId}`;
const MORE_KEY = "coffeeLedger.moreFields";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode: the draft just doesn't survive a reload */
  }
}

export function readDraft(entryId: string): ShotForm | null {
  const raw = read(draftKey(entryId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ShotForm>;
    const form = { ...EMPTY_FORM, ...parsed };
    return isBlank(form) ? null : form;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- composer */

/** Logging a new shot. Starts empty every time — the recipe may be what's
 *  changing, and typing four numbers is quicker than checking four prefilled
 *  ones. The previous shots sit right below it for reference. */
export function ShotComposer({
  entryId,
  number,
  onClose,
}: {
  entryId: string;
  /** What this shot will be numbered in the log. */
  number: number;
  onClose: () => void;
}) {
  const [restored] = React.useState(() => readDraft(entryId) !== null);
  const [form, setForm] = React.useState<ShotForm>(() => readDraft(entryId) ?? EMPTY_FORM);

  const change = (patch: Partial<ShotForm>) =>
    setForm((prev) => {
      const next = { ...prev, ...patch };
      write(draftKey(entryId), isBlank(next) ? null : JSON.stringify(next));
      return next;
    });

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (isBlank(form)) return;
    addShot(entryId, shotPatchOf(form));
    write(draftKey(entryId), null);
    toast.success(`Shot #${number} logged`);
    onClose();
  };

  const cancel = () => {
    write(draftKey(entryId), null);
    onClose();
  };

  return (
    <form
      onSubmit={save}
      aria-label="New shot"
      className="rounded-md border border-foreground/25 bg-card p-4 shadow-card"
    >
      <div className="flex items-center gap-3">
        <h3 className="label-mono text-muted-foreground">Shot #{number}</h3>
        {restored && <span className="text-[12px] text-muted-foreground">Draft restored</span>}
        <StarToggle
          starred={form.starred}
          onToggle={() => change({ starred: !form.starred })}
          className="-my-2 -mr-2 ml-auto"
        />
      </div>

      <div className="mt-4">
        <ShotFields form={form} onChange={change} autoFocus />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button type="submit" className="h-11 px-5" disabled={isBlank(form)}>
          Save shot
        </Button>
        <Button type="button" variant="ghost" className="h-11" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ fields */

/** The shot's inputs, shared by the composer and by editing a logged shot so
 *  the two can't drift apart. Grind, dose, yield and time first — the four
 *  numbers every shot has — then pre-infusion, taste and notes; temperature
 *  and RPM behind "More". */
export function ShotFields({
  form,
  onChange,
  autoFocus = false,
}: {
  form: ShotForm;
  onChange: (patch: Partial<ShotForm>) => void;
  autoFocus?: boolean;
}) {
  const [more, setMore] = React.useState(
    () => read(MORE_KEY) === "1" || form.temp !== "" || form.rpm !== "",
  );
  const toggleMore = () => {
    write(MORE_KEY, more ? "0" : "1");
    setMore(!more);
  };

  const text =
    (key: keyof ShotForm) => (event: React.ChangeEvent<HTMLInputElement>) =>
      onChange({ [key]: event.target.value } as Partial<ShotForm>);

  const ratio = ratioOf(form.dose, form.yield);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Grind" value={form.grind} onChange={text("grind")} autoFocus={autoFocus} />
        <NumberField label="Time" unit="s" value={form.time} onChange={text("time")} />
        <NumberField label="Dose" unit="g" value={form.dose} onChange={text("dose")} />
        <NumberField label="Yield" unit="g" value={form.yield} onChange={text("yield")} />
      </div>

      <p className="-mt-1 font-mono text-[13px] text-muted-foreground" aria-live="polite">
        {ratio ? (
          <>
            Ratio <span className="text-foreground">{ratio}</span>
          </>
        ) : (
          "Ratio appears once dose and yield are in."
        )}
      </p>

      {/* Stacked below 360px, where "Pre-infusion" can't fit half a row. */}
      <div className="grid grid-cols-1 items-end gap-3 min-[360px]:grid-cols-2">
        <NumberField label="Pre-infusion" unit="s" value={form.infusion} onChange={text("infusion")} />
        <button
          type="button"
          aria-pressed={form.ps}
          onClick={() => onChange({ ps: !form.ps })}
          className={cn(
            "label-mono flex h-11 items-center justify-center rounded-md border transition-colors",
            "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
            form.ps
              ? "border-foreground bg-foreground text-background"
              : "border-input bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          Pre-soak {form.ps ? "on" : "off"}
        </button>
      </div>

      <TasteScale value={form.extraction} onChange={(extraction) => onChange({ extraction })} />

      <TextField label="Notes" value={form.notes} onChange={text("notes")} placeholder="Syrupy, a little channeling" />

      <div>
        <button
          type="button"
          onClick={toggleMore}
          aria-expanded={more}
          className="label-mono inline-flex items-center gap-1 py-1 text-muted-foreground hover:text-foreground"
        >
          <ChevronDownIcon className={cn("size-3.5 transition-transform", more && "rotate-180")} />
          {more ? "Less" : "More: temp, RPM"}
        </button>
        {more && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <NumberField label="Temp" unit="°C" value={form.temp} onChange={text("temp")} />
            <NumberField label="RPM" value={form.rpm} onChange={text("rpm")} />
          </div>
        )}
      </div>
    </div>
  );
}

/** A labelled box for a number, with its unit inside on the right. Text, not
 *  type="number": "~18.2" and "18,2" are both things people type, and number
 *  inputs silently empty themselves on anything they don't parse. The decimal
 *  keypad still comes up on a phone. */
function NumberField({
  label,
  unit,
  className,
  ...props
}: React.ComponentProps<"input"> & { label: string; unit?: string }) {
  const id = React.useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="label-mono text-muted-foreground">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="next"
          {...props}
          className={cn("h-11 font-mono", unit && "pr-9", className)}
        />
        {unit && (
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-[13px] text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

function TextField({ label, ...props }: React.ComponentProps<"input"> & { label: string }) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="label-mono text-muted-foreground">
        {label}
      </Label>
      <Input id={id} autoComplete="off" {...props} className="h-11" />
    </div>
  );
}

/** Five taps from sour to bitter. Nothing is chosen until you taste it, and
 *  tapping the chosen step again un-chooses it. */
export function TasteScale({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const current = tasteOf(value);
  const labelId = React.useId();

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span id={labelId} className="label-mono text-muted-foreground">
          Taste
        </span>
        <span className={cn("text-[13px]", current ? "text-foreground" : "text-muted-foreground")}>
          {current ? current.label : "Not tasted yet"}
        </span>
      </div>
      <div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-5 gap-1.5">
        {TASTES.map((taste) => {
          const chosen = current?.value === taste.value;
          return (
            <button
              key={taste.value}
              type="button"
              role="radio"
              aria-checked={chosen}
              aria-label={taste.label}
              onClick={() => onChange(chosen ? null : taste.value)}
              className={cn(
                "h-11 rounded-md border transition-colors",
                "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
                chosen
                  ? "border-foreground bg-foreground"
                  : "border-input bg-card hover:border-foreground/40",
              )}
            />
          );
        })}
      </div>
      <div className="flex justify-between font-mono text-[11px] text-muted-foreground" aria-hidden>
        <span>Sour</span>
        <span>Balanced</span>
        <span>Bitter</span>
      </div>
    </div>
  );
}

export function StarToggle({
  starred,
  onToggle,
  className,
}: {
  starred: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={starred}
      aria-label={starred ? "Unstar this shot" : "Mark as a best shot"}
      onClick={onToggle}
      className={cn(
        "grid size-11 place-items-center rounded-md transition-colors hover:bg-accent",
        "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
        className,
      )}
    >
      <StarIcon
        className={cn("size-5", starred ? "fill-status text-status" : "text-muted-foreground")}
      />
    </button>
  );
}
