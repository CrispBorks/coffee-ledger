import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** A titled block of a form, ruled off from the next. Shared by the add page
 *  and the profile page so the two read as the same kind of screen. */
export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col">
      <h2 className="label-mono border-b border-border pb-2 text-muted-foreground">
        {title}
      </h2>
      {hint && <p className="mt-3 text-[13px] text-muted-foreground">{hint}</p>}
      <div className="mt-4 flex flex-col">{children}</div>
    </section>
  );
}

/** One labelled input; the label is wired to it by id. */
export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <Label htmlFor={id} className="label-mono text-muted-foreground">
        {label}
      </Label>
      {children(id)}
      {hint && <span className="text-[12px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

/** A labelled box for a number, with its unit inside on the right. Text, not
 *  type="number": "~18.2" and "18,2" are both things people type, and number
 *  inputs silently empty themselves on anything they don't parse. The decimal
 *  keypad still comes up on a phone. */
export function NumberField({
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
