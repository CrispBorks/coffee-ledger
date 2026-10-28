import * as React from "react";
import { CheckIcon, CopyIcon, KeyRoundIcon } from "lucide-react";

import { SiteFooter } from "@/components/page-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAccount, signIn, useLedger } from "@/lib/ledger";

/** What stands in front of the whole app until this device has a token the
 *  server accepts. Two ways through: paste a token you already have, or ask for
 *  a new ledger — in which case the token is shown once, here, and only becomes
 *  this device's after you say you've kept it. */
export function TokenGate() {
  const { loadError, needsSetup } = useLedger();

  const [token, setTokenText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  // Set once a new ledger has been made and its token is on screen.
  const [issued, setIssued] = React.useState("");
  const [kept, setKept] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  async function unlock(value: string) {
    setBusy(true);
    setError("");
    const result = await signIn(value);
    setBusy(false);
    if (!result.ok) setError(result.error);
  }

  async function start() {
    setBusy(true);
    setError("");
    const made = await createAccount();
    setBusy(false);
    if ("error" in made) setError(made.error);
    else setIssued(made.token);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(issued);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy automatically — select the token and copy it by hand.");
    }
  }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-[560px] flex-col px-5">
      <header className="mb-7 flex items-center justify-between gap-4 border-b border-border pt-9 pb-5">
        <span className="display text-[28px] leading-none font-semibold">Coffee Ledger</span>
        <ThemeToggle />
      </header>

      <main className="flex-1">
        {issued === "" ? (
          <div className="space-y-8">
            <section>
              <h1 className="display text-[22px] font-semibold">Open your ledger</h1>
              <p className="mt-2 text-[14px] text-muted-foreground">
                Every ledger is private to its token. Enter yours to open it.
              </p>

              <form
                className="mt-4 space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void unlock(token);
                }}
              >
                <Label htmlFor="token" className="label-mono">
                  Token
                </Label>
                <Input
                  id="token"
                  value={token}
                  onChange={(event) => setTokenText(event.target.value)}
                  placeholder="Your token"
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={error !== "" || undefined}
                  className="font-mono text-[13px]"
                />
                <Button type="submit" disabled={busy || token.trim() === ""}>
                  <KeyRoundIcon />
                  {busy ? "Checking…" : "Open ledger"}
                </Button>
              </form>
            </section>

            <section className="border-t border-border pt-6">
              <h2 className="display text-[18px] font-semibold">New here?</h2>
              <p className="mt-2 text-[14px] text-muted-foreground">
                Start an empty ledger of your own. You'll get a token — the only key to it.
              </p>
              <Button variant="outline" className="mt-4" disabled={busy} onClick={start}>
                Start a new ledger
              </Button>
            </section>

            {(error !== "" || loadError !== "") && (
              <p role="alert" className="text-[13px] text-destructive">
                {error !== "" ? error : loadError}
              </p>
            )}
            {needsSetup && (
              <p className="text-[13px] text-muted-foreground">
                This deployment has no database connected yet, so no ledger can be opened or
                started.
              </p>
            )}
          </div>
        ) : (
          <section className="space-y-5">
            <div>
              <h1 className="display text-[22px] font-semibold">Keep this token</h1>
              <p className="mt-2 text-[14px] text-muted-foreground">
                This is the only time it will be shown. The server keeps a fingerprint of it, not
                the token, so it can't be looked up or reset. Lose it and the ledger is gone with
                it.
              </p>
            </div>

            <div className="rounded-md border border-border bg-card p-3">
              <code
                data-testid="issued-token"
                className="block font-mono text-[13px] leading-relaxed break-all select-all"
              >
                {issued}
              </code>
              <Button size="sm" variant="outline" className="mt-3" onClick={copy}>
                {copied ? <CheckIcon /> : <CopyIcon />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>

            <div className="flex items-start gap-2.5">
              <Checkbox
                id="kept"
                checked={kept}
                onCheckedChange={(value) => setKept(value === true)}
                className="mt-0.5"
              />
              <Label htmlFor="kept" className="text-[14px] leading-snug font-normal">
                I've saved it somewhere safe, like a password manager.
              </Label>
            </div>

            {error !== "" && (
              <p role="alert" className="text-[13px] text-destructive">
                {error}
              </p>
            )}

            <Button disabled={!kept || busy} onClick={() => void unlock(issued)}>
              {busy ? "Opening…" : "Open my ledger"}
            </Button>
          </section>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
