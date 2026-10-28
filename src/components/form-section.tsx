import * as React from "react";

import { Label } from "@/components/ui/label";

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
