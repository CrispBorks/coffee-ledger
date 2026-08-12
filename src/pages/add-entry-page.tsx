import * as React from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BackLink, PageShell, SiteFooter } from "@/components/page-shell";
import { addEntry, EMPTY_ENTRY, type Entry } from "@/lib/ledger";

type FormValues = Omit<Entry, "id" | "createdAt" | "shots">;

export function AddEntryPage() {
  const navigate = useNavigate();
  const [values, setValues] = React.useState<FormValues>({ ...EMPTY_ENTRY });

  React.useEffect(() => {
    document.title = "Add a coffee — Coffee Ledger";
  }, []);

  const set = (key: keyof FormValues) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => setValues((prev) => ({ ...prev, [key]: e.target.value }));

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const entry = addEntry(values);
    navigate(`/entry/${entry.id}`);
  };

  return (
    <PageShell width="reading">
      <div className="pt-9 pb-5">
        <BackLink />
      </div>

      <h1 className="display text-[30px] leading-none font-semibold">Add a coffee</h1>
      <p className="mt-3 max-w-[60ch] text-[14px] text-muted-foreground">
        Log what's in the bag now — you'll add shots once you start dialing it in.
      </p>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-8">
        <Section title="Coffee">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Coffee">
              {(id) => (
                <Input
                  id={id}
                  value={values.coffee}
                  onChange={set("coffee")}
                  placeholder="Kochere Natural"
                  autoFocus
                />
              )}
            </Field>
            <Field label="Roaster">
              {(id) => (
                <Input
                  id={id}
                  value={values.roaster}
                  onChange={set("roaster")}
                  placeholder="Sey Coffee"
                />
              )}
            </Field>
            <Field label="Origin(s)">
              {(id) => (
                <Input
                  id={id}
                  value={values.origins}
                  onChange={set("origins")}
                  placeholder="Ethiopia"
                />
              )}
            </Field>
            <Field label="Altitude" hint="MASL">
              {(id) => (
                <Input
                  id={id}
                  value={values.altitude}
                  onChange={set("altitude")}
                  placeholder="1900"
                  inputMode="numeric"
                  className="font-mono"
                />
              )}
            </Field>
          </div>
          <Field label="Tasting notes" className="mt-4">
            {(id) => (
              <Textarea
                id={id}
                value={values.tastingNotes}
                onChange={set("tastingNotes")}
                placeholder="Blueberry, jasmine, dark chocolate"
                rows={2}
              />
            )}
          </Field>
        </Section>

        <Section title="Roast">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Roast level">
              {(id) => (
                <Input
                  id={id}
                  value={values.roastLevel}
                  onChange={set("roastLevel")}
                  placeholder="Light"
                />
              )}
            </Field>
            <Field label="Roast date">
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  value={values.roastDate}
                  onChange={set("roastDate")}
                  className="font-mono"
                />
              )}
            </Field>
            <Field label="Process">
              {(id) => (
                <Input
                  id={id}
                  value={values.process}
                  onChange={set("process")}
                  placeholder="Washed"
                />
              )}
            </Field>
            <Field label="Variety">
              {(id) => (
                <Input
                  id={id}
                  value={values.variety}
                  onChange={set("variety")}
                  placeholder="Heirloom"
                />
              )}
            </Field>
          </div>
          <Field label="Comments" className="mt-4">
            {(id) => (
              <Textarea
                id={id}
                value={values.comments}
                onChange={set("comments")}
                placeholder="Anything else worth remembering about this bag"
                rows={2}
              />
            )}
          </Field>
        </Section>

        <Section title="Gear" hint="What you're using this bag with — fills in the shot log for you.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Machine">
              {(id) => (
                <Input
                  id={id}
                  value={values.machine}
                  onChange={set("machine")}
                  placeholder="Decent DE1"
                />
              )}
            </Field>
            <Field label="Grinder">
              {(id) => (
                <Input
                  id={id}
                  value={values.grinder}
                  onChange={set("grinder")}
                  placeholder="Niche Zero"
                />
              )}
            </Field>
            <Field label="Basket">
              {(id) => (
                <Input
                  id={id}
                  value={values.basket}
                  onChange={set("basket")}
                  placeholder="VST 18g"
                />
              )}
            </Field>
            <Field label="Other">
              {(id) => (
                <Input
                  id={id}
                  value={values.other}
                  onChange={set("other")}
                  placeholder="Puck screen, WDT, etc."
                />
              )}
            </Field>
          </div>
        </Section>

        <div className="flex flex-wrap gap-2">
          <Button type="submit">Add to ledger</Button>
        </div>
      </form>

      <SiteFooter />
    </PageShell>
  );
}

function Section({
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

function Field({
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
