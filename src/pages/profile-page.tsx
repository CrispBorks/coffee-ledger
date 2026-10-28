import * as React from "react";
import { CheckIcon } from "lucide-react";
import { toast } from "sonner";

import { Field, Section } from "@/components/form-section";
import { BackLink, PageShell, SiteFooter } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changeToken, updateProfile, useLedger, type Profile } from "@/lib/ledger";
import { MIN_CHOSEN_LENGTH, chosenTokenProblem } from "@/lib/tokens";

/** One person's corner: what to call them, the gear every coffee they add is
 *  recorded with, and the token that opens their ledger. Whoever's token is in
 *  this device sees their own — there is no list of profiles to pick from,
 *  because the token already says whose this is. */
export function ProfilePage() {
  const { profile } = useLedger();

  React.useEffect(() => {
    document.title = profile.name
      ? `${profile.name} — Coffee Ledger`
      : "Profile — Coffee Ledger";
  }, [profile.name]);

  // Saved the way the coffee page saves: as you type, a moment after you stop.
  const set = (key: keyof Profile) => (event: React.ChangeEvent<HTMLInputElement>) =>
    updateProfile({ [key]: event.target.value });

  return (
    <PageShell width="reading">
      <div className="pt-9 pb-5">
        <BackLink />
      </div>

      <h1 className="display text-[30px] leading-none font-semibold break-words">
        {profile.name.trim() || "Your profile"}
      </h1>
      <p className="mt-3 max-w-[60ch] text-[14px] text-muted-foreground">
        Your profile and your coffees belong to your token. Someone else's token opens
        theirs — the two never mix.
      </p>

      <div className="mt-8 flex flex-col gap-8">
        <Section title="You">
          <Field label="Name">
            {(id) => (
              <Input
                id={id}
                value={profile.name}
                onChange={set("name")}
                placeholder="Yash"
                autoComplete="name"
              />
            )}
          </Field>
        </Section>

        <Section
          title="Gear"
          hint="Set once. Every coffee you add is recorded with this gear, so changing it later doesn't change what older coffees were pulled on."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Machine">
              {(id) => (
                <Input id={id} value={profile.machine} onChange={set("machine")} placeholder="Decent DE1" />
              )}
            </Field>
            <Field label="Grinder">
              {(id) => (
                <Input id={id} value={profile.grinder} onChange={set("grinder")} placeholder="Niche Zero" />
              )}
            </Field>
            <Field label="Basket">
              {(id) => (
                <Input id={id} value={profile.basket} onChange={set("basket")} placeholder="VST 18g" />
              )}
            </Field>
            <Field label="Other">
              {(id) => (
                <Input
                  id={id}
                  value={profile.other}
                  onChange={set("other")}
                  placeholder="Puck screen, WDT, etc."
                />
              )}
            </Field>
          </div>
        </Section>

        <TokenSection />
      </div>

      <SiteFooter />
    </PageShell>
  );
}

/** Swap the generated cl_… token for one you can remember. Shown in plain text
 *  while typing — there's no second "confirm" box, so seeing it is what
 *  catches a typo before it becomes the only way in. */
function TokenSection() {
  const [next, setNext] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [changedTo, setChangedTo] = React.useState("");

  // Only complain once something has been typed; an empty box isn't wrong yet.
  const problem = next.trim() ? chosenTokenProblem(next) : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await changeToken(next);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setChangedTo(result.token);
    setNext("");
    toast.success("Token changed");
  }

  return (
    <Section
      title="Token"
      hint="Your token opens this ledger on any device. Swap the long generated one for something you'll remember."
    >
      {changedTo && (
        <div
          role="status"
          className="mb-4 flex items-start gap-2.5 rounded-md border border-border bg-card p-3 text-[14px]"
        >
          <CheckIcon className="mt-0.5 size-4 shrink-0 text-status-foreground" />
          <p className="min-w-0">
            Your token is now{" "}
            <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[13px] break-all">
              {changedTo}
            </code>
            . This device is already using it — enter it on your other devices.
          </p>
        </div>
      )}

      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field
          label="New token"
          hint={`At least ${MIN_CHOSEN_LENGTH} characters. Not case-sensitive. Pick something only you'd think of — anyone who guesses it can open this ledger.`}
        >
          {(id) => (
            <Input
              id={id}
              value={next}
              onChange={(event) => {
                setNext(event.target.value);
                setError("");
              }}
              placeholder="blue moon espresso"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={problem !== null || error !== "" || undefined}
              className="font-mono"
            />
          )}
        </Field>

        {(problem || error) && (
          <p role="alert" className="text-[13px] text-destructive">
            {error || problem}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="submit" disabled={busy || !next.trim() || problem !== null}>
            {busy ? "Changing…" : "Change token"}
          </Button>
          <span className="text-[12px] text-muted-foreground">
            Other devices will need the new one.
          </span>
        </div>
      </form>
    </Section>
  );
}
