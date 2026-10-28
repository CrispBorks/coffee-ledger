/** The write queue is the part of the database work that could quietly lose
 *  someone's shot log, so it's the part with tests. Everything here drives the
 *  real store against a stubbed fetch and asserts on the requests it makes. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { method: string; url: string; body: any };
type Reply = { status?: number; body?: unknown };

let calls: Call[] = [];
let reply: (call: Call) => Reply = () => ({});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait for something to become true, rather than for a fixed number of
 *  milliseconds — the store debounces for 600ms and then drains a queue. */
async function until(check: () => boolean, what: string, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}

type Ledger = typeof import("../src/lib/ledger");

async function freshLedger(entries: unknown[] = []): Promise<Ledger> {
  reply = (call) => (call.url.startsWith("/api/entries") ? { body: { entries } } : {});
  vi.resetModules();
  const ledger: Ledger = await import("../src/lib/ledger");
  await ledger.loadLedger();
  calls = [];
  return ledger;
}

const posts = (path: string) =>
  calls.filter((c) => c.method === "POST" && c.url.startsWith(path));

beforeEach(() => {
  calls = [];
  reply = () => ({});
  globalThis.fetch = (async (url: unknown, init: RequestInit = {}) => {
    const call: Call = {
      method: init.method ?? "GET",
      url: String(url),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const { status = 200, body = { ok: true } } = reply(call);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reading", () => {
  it("loads the ledger and reports it ready", async () => {
    const ledger = await freshLedger([
      { id: "a", coffee: "Kochere", shots: [{ id: "s1", dose: "18" }] },
    ]);
    const state = ledger.ledgerState();
    expect(state.status).toBe("ready");
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].shots[0].dose).toBe("18");
    // Fields the row didn't carry are filled in, not left undefined.
    expect(state.entries[0].roaster).toBe("");
  });

  it("reports the routes not running rather than a parse error", async () => {
    vi.resetModules();
    globalThis.fetch = (async () =>
      new Response("<!doctype html><title>Coffee Ledger</title>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;
    const ledger: Ledger = await import("../src/lib/ledger");
    await ledger.loadLedger();
    expect(ledger.ledgerState().status).toBe("unreachable");
    expect(ledger.ledgerState().loadError).toMatch(/vercel dev/);
  });

  it("keeps the ledger unreachable rather than showing an empty one", async () => {
    vi.resetModules();
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "No database is connected.", needsSetup: true }), {
        status: 503,
      })) as unknown as typeof fetch;
    const ledger: Ledger = await import("../src/lib/ledger");
    await ledger.loadLedger();
    expect(ledger.ledgerState().status).toBe("unreachable");
    expect(ledger.ledgerState().needsSetup).toBe(true);
    expect(ledger.ledgerState().entries).toEqual([]);
  });
});

describe("writing", () => {
  it("shows a new coffee before the write and saves it without being asked", async () => {
    const ledger = await freshLedger();
    const entry = ledger.addEntry({ ...ledger.EMPTY_ENTRY, coffee: "Kochere" });

    // On screen immediately — the write is a consequence, not a gate.
    expect(ledger.ledgerState().entries[0].id).toBe(entry.id);

    await until(() => posts("/api/entries").length === 1, "the entry write");
    expect(posts("/api/entries")[0].body.coffee).toBe("Kochere");
    // Shots are keyed separately, so they're left out rather than sent.
    expect(posts("/api/entries")[0].body.shots).toBeUndefined();
  });

  it("inserts a coffee before the first shot logged against it", async () => {
    const ledger = await freshLedger();
    const entry = ledger.addEntry({ ...ledger.EMPTY_ENTRY, coffee: "Kochere" });
    ledger.addShot(entry.id);
    ledger.addShot(entry.id);

    await until(() => ledger.ledgerState().unsaved === 0, "the queue to drain");
    expect(calls.map((c) => c.url)).toEqual([
      "/api/entries",
      "/api/shots",
      "/api/shots",
    ]);
    expect(calls[1].body.entryId).toBe(entry.id);
  });

  it("collapses a burst of keystrokes into one write of the final value", async () => {
    const ledger = await freshLedger([{ id: "a", coffee: "" }]);
    for (const text of ["K", "Ko", "Koc", "Koch", "Kochere"]) {
      ledger.updateEntry("a", { coffee: text });
    }

    await until(() => ledger.ledgerState().unsaved === 0, "the queue to drain");
    expect(posts("/api/entries")).toHaveLength(1);
    expect(posts("/api/entries")[0].body.coffee).toBe("Kochere");
  });

  it("writes each shot on its own, not the coffee around it", async () => {
    const ledger = await freshLedger([
      { id: "a", coffee: "Kochere", shots: [{ id: "s1" }, { id: "s2" }] },
    ]);
    ledger.updateShot("a", "s1", { dose: "18" });
    ledger.updateShot("a", "s2", { dose: "19" });

    await until(() => ledger.ledgerState().unsaved === 0, "the queue to drain");
    expect(posts("/api/entries")).toHaveLength(0);
    expect(posts("/api/shots").map((c) => c.body.shot.dose).sort()).toEqual(["18", "19"]);
  });

  it("doesn't write shots for a coffee that has just been deleted", async () => {
    const ledger = await freshLedger([{ id: "a", coffee: "Kochere", shots: [{ id: "s1" }] }]);
    ledger.updateShot("a", "s1", { dose: "18" });
    ledger.deleteEntry("a");

    await until(() => ledger.ledgerState().unsaved === 0, "the queue to drain");
    expect(posts("/api/shots")).toHaveLength(0);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["DELETE /api/entries?id=a"]);
  });

  it("treats a row that is already gone as deleted", async () => {
    const ledger = await freshLedger([{ id: "a" }]);
    reply = () => ({ status: 404, body: { error: "No coffee in the ledger." } });
    ledger.deleteEntry("a");

    await until(() => ledger.ledgerState().unsaved === 0, "the delete");
    expect(ledger.ledgerState().failed).toBe(0);
    expect(ledger.ledgerState().writeError).toBe("");
  });

  it("sends a resting edit when the page is going away", async () => {
    const ledger = await freshLedger([{ id: "a", coffee: "" }]);
    ledger.updateEntry("a", { coffee: "Kochere" });
    expect(posts("/api/entries")).toHaveLength(0); // still inside the debounce

    ledger.flushPending();
    await until(() => posts("/api/entries").length === 1, "the flushed write");
    expect(posts("/api/entries")[0].body.coffee).toBe("Kochere");
  });
});

describe("when a write does not land", () => {
  it("holds a write the server broke on, keeping what was typed", async () => {
    const ledger = await freshLedger([{ id: "a", coffee: "" }]);
    reply = (call) =>
      call.url.startsWith("/api/entries") && call.method === "POST"
        ? { status: 500, body: { error: "Database error: connection reset" } }
        : {};

    ledger.updateEntry("a", { coffee: "Kochere" });
    await until(() => ledger.ledgerState().failed === 1, "the failure to be held");

    const held = ledger.ledgerState();
    expect(held.unsaved).toBe(1);
    expect(held.writeError).toMatch(/connection reset/);
    // Nothing was rolled back — what's on screen is still what was typed.
    expect(held.entries[0].coffee).toBe("Kochere");

    reply = () => ({});
    ledger.retryFailed();
    await until(() => ledger.ledgerState().unsaved === 0, "the retried write");
    expect(ledger.ledgerState().writeError).toBe("");
    expect(posts("/api/entries").at(-1)?.body.coffee).toBe("Kochere");
  });

  it("holds a write through a network failure and retries it", async () => {
    const ledger = await freshLedger([{ id: "a", coffee: "" }]);
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    ledger.updateEntry("a", { coffee: "Kochere" });
    await until(() => ledger.ledgerState().failed === 1, "the failure to be held");
    expect(ledger.ledgerState().writeError).toMatch(/Offline/);

    let sent = 0;
    globalThis.fetch = (async () => {
      sent += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    ledger.retryFailed();
    await until(() => ledger.ledgerState().unsaved === 0, "the retry");
    expect(sent).toBe(1);
    expect(ledger.ledgerState().writeError).toBe("");
  });

  it("lets go of a change the ledger can never accept, and re-reads", async () => {
    const ledger = await freshLedger([{ id: "a", coffee: "Kochere", shots: [{ id: "s1" }] }]);
    reply = (call) =>
      call.url === "/api/shots"
        ? { status: 409, body: { error: "That coffee is no longer in the ledger." } }
        : { body: { entries: [] } };

    ledger.updateShot("a", "s1", { dose: "18" });

    await until(() => ledger.ledgerState().writeError !== "", "the refusal");
    expect(ledger.ledgerState().writeError).toMatch(/no longer in the ledger/);
    // Not retried for ever, and the screen is reconciled with the database.
    await until(() => ledger.ledgerState().entries.length === 0, "the re-read");
    expect(ledger.ledgerState().failed).toBe(0);
  });
});

describe("logging and undoing shots", () => {
  it("logs a shot with everything filled in as one write", async () => {
    const ledger = await freshLedger([{ id: "a", coffee: "Kochere" }]);
    ledger.addShot("a", { dose: "18", yield: "40", timeSec: "28", grind: "3.2", extraction: 30 });

    await until(() => ledger.ledgerState().unsaved === 0, "the shot write");
    const writes = posts("/api/shots");
    expect(writes).toHaveLength(1);
    expect(writes[0].body.shot).toMatchObject({
      dose: "18",
      yield: "40",
      timeSec: "28",
      grind: "3.2",
      extraction: 30,
    });
    expect(writes[0].body.shot.pulledAt).toBeGreaterThan(0);
  });

  it("starts a shot as not tasted", async () => {
    const ledger = await freshLedger([{ id: "a" }]);
    ledger.addShot("a", { dose: "18" });
    expect(ledger.ledgerState().entries[0].shots[0].extraction).toBeNull();
  });

  it("puts an undone delete back in its place in the log", async () => {
    const ledger = await freshLedger([
      {
        id: "a",
        shots: [
          { id: "s1", pulledAt: 1_000 },
          { id: "s2", pulledAt: 2_000 },
          { id: "s3", pulledAt: 3_000 },
        ],
      },
    ]);
    const removed = ledger.deleteShot("a", "s2");
    expect(removed?.id).toBe("s2");
    await until(() => ledger.ledgerState().unsaved === 0, "the delete");

    ledger.restoreShot("a", removed!);
    expect(ledger.ledgerState().entries[0].shots.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);

    await until(() => ledger.ledgerState().unsaved === 0, "the restore");
    const restored = posts("/api/shots").at(-1)?.body.shot;
    // Same id and the same pull time, so the server files it where it was.
    expect(restored).toMatchObject({ id: "s2", pulledAt: 2_000 });
  });

  it("never tells the server when the undo beats the delete out of the door", async () => {
    const ledger = await freshLedger([{ id: "a", shots: [{ id: "s1", pulledAt: 1_000 }] }]);
    // Hold the network so the delete is still queued when Undo is tapped.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const original = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      await gate;
      return original(...args);
    }) as typeof fetch;

    ledger.addShot("a", { dose: "18" }); // occupies the one in-flight slot
    const removed = ledger.deleteShot("a", "s1")!;
    ledger.restoreShot("a", removed);
    release();

    await until(() => ledger.ledgerState().unsaved === 0, "the queue to drain");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(ledger.ledgerState().entries[0].shots.map((s) => s.id)[0]).toBe("s1");
  });

  it("returns nothing for a shot that isn't there", async () => {
    const ledger = await freshLedger([{ id: "a" }]);
    expect(ledger.deleteShot("a", "nope")).toBeUndefined();
  });
});
