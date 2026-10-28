import * as React from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, Section } from "@/components/form-section";
import { GearSummary } from "@/components/gear-summary";
import { BackLink, PageShell, SiteFooter } from "@/components/page-shell";
import { BagFields } from "@/components/bag-fields";
import { addEntry, EMPTY_ENTRY, GEAR_FIELDS, useLedger, type NewCoffee } from "@/lib/ledger";

type FormValues = NewCoffee;

/** Gear comes from the profile and a weigh-in only happens later, so neither
 *  is part of what this form starts with. */
const NOT_ASKED: readonly string[] = [...GEAR_FIELDS, "weighedGrams"];

const BLANK = Object.fromEntries(
  Object.entries(EMPTY_ENTRY).filter(([field]) => !NOT_ASKED.includes(field)),
) as FormValues;

export function AddEntryPage() {
  const navigate = useNavigate();
  const { status, needsSetup, profile } = useLedger();
  const [values, setValues] = React.useState<FormValues>({ ...BLANK });

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

      {/* Worth saying before the form rather than after it: filling this in and
          then being told it can't be stored is the wrong order. */}
      {(needsSetup || status === "unreachable") && (
        <p className="mt-5 rounded-md border border-dashed border-destructive/50 p-4 text-[13px] text-muted-foreground">
          {needsSetup
            ? "This deployment has no database connected yet, so a coffee added here won't be stored. Connecting one in the Vercel dashboard is the only setup there is — see the README."
            : "The ledger can't be reached right now. A coffee added here is kept on this screen and saved as soon as the connection is back — but don't close the tab until it has."}
        </p>
      )}

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

        <Section title="Bag">
          <BagFields
            values={values}
            onChange={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
          />
        </Section>

        {/* Gear used to be four more fields here, retyped for every bag. It
            lives on the profile now; this says what will be recorded. */}
        <section className="rounded-md border border-dashed border-border p-4">
          <h2 className="label-mono text-muted-foreground">Gear</h2>
          <div className="mt-2">
            <GearSummary
              gear={profile}
              lead="This coffee will be added with"
              empty="No gear yet — it's set once, on your profile, and added to every coffee."
            />
          </div>
        </section>

        <div className="flex flex-wrap gap-2">
          <Button type="submit">Add to ledger</Button>
        </div>
      </form>

      <SiteFooter />
    </PageShell>
  );
}
