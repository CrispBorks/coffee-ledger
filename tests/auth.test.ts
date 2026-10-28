/** The client half of the token: what the store sends, what it does when the
 *  server says no, and what it forgets when you lock the device.
 *
 *  Driven against a stubbed fetch and an in-memory localStorage, the same way
 *  ledger.test.ts drives the write queue. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const GOOD = "cl_" + "a".repeat(43);
const OTHER = "cl_" + "b".repeat(43);

type Call = { method: string; url: string; auth: string | undefined; body: any };
type Reply = { status?: number; body?: unknown };

let calls: Call[] = [];
let reply: (call: Call) => Reply = () => ({});
let storage: Map<string, string>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Ledger = typeof import("../src/lib/ledger");

async function freshLedger(): Promise<Ledger> {
  vi.resetModules();
  return import("../src/lib/ledger");
}

beforeEach(() => {
  calls = [];
  reply = () => ({});
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  globalThis.fetch = (async (url: unknown, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const call: Call = {
      method: init.method ?? "GET",
      url: String(url),
      auth: headers.authorization,
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

describe("sending the token", () => {
  it("puts the stored token on every request", async () => {
    storage.set("coffeeLedger.token", GOOD);
    reply = () => ({ body: { entries: [] } });
    const ledger = await freshLedger();
    await ledger.loadLedger();

    expect(calls[0].url).toBe("/api/entries");
    expect(calls[0].auth).toBe(`Bearer ${GOOD}`);
  });

  it("sends nothing when there is no token", async () => {
    reply = () => ({ body: { entries: [] } });
    const ledger = await freshLedger();
    await ledger.loadLedger();
    expect(calls[0].auth).toBeUndefined();
  });
});

describe("when the server says no", () => {
  it("locks the ledger and empties the screen if the first read is refused", async () => {
    storage.set("coffeeLedger.token", GOOD);
    reply = () => ({ status: 401, body: { error: "A valid token is needed.", unauthorized: true } });
    const ledger = await freshLedger();
    await ledger.loadLedger();

    const state = ledger.ledgerState();
    expect(state.status).toBe("locked");
    expect(state.entries).toEqual([]);
  });

  it("locks the ledger if a write is refused, and holds the change", async () => {
    storage.set("coffeeLedger.token", GOOD);
    reply = (call) => (call.url.startsWith("/api/entries") && call.method === "GET" ? { body: { entries: [] } } : { status: 401, body: { error: "no" } });
    const ledger = await freshLedger();
    await ledger.loadLedger();

    ledger.addEntry({ ...ledger.EMPTY_ENTRY, coffee: "Kochere" });
    const until = Date.now() + 2000;
    while (ledger.ledgerState().status !== "locked" && Date.now() < until) await sleep(10);

    expect(ledger.ledgerState().status).toBe("locked");
  });
});

describe("signing in", () => {
  it.each([
    ["abc", "too short to be a chosen token"],
    ["café crème", "not ASCII"],
    ["", "empty"],
  ])("refuses %j (%s) without asking the server", async (typed) => {
    const ledger = await freshLedger();
    const result = await ledger.signIn(typed);
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
    expect(storage.has("coffeeLedger.token")).toBe(false);
  });

  it("accepts a chosen token, tidied the way the server tidies it", async () => {
    const ledger = await freshLedger();
    reply = (call) => (call.url === "/api/entries" ? { body: { entries: [] } } : {});
    const result = await ledger.signIn("  Blue  Moon ");
    expect(result).toEqual({ ok: true });
    expect(storage.get("coffeeLedger.token")).toBe("blue moon");
    expect(calls[0].auth).toBe("Bearer blue moon");
  });

  it("checks the token with the server, keeps it, and loads that ledger", async () => {
    reply = (call) =>
      call.url === "/api/session"
        ? { body: { ok: true } }
        : { body: { entries: [{ id: "a", coffee: "Kochere", shots: [] }] } };
    const ledger = await freshLedger();

    const result = await ledger.signIn(`  ${GOOD}\n`); // pasted with whitespace
    expect(result).toEqual({ ok: true });

    expect(calls[0]).toMatchObject({ url: "/api/session", auth: `Bearer ${GOOD}` });
    expect(storage.get("coffeeLedger.token")).toBe(GOOD);
    expect(ledger.ledgerState().status).toBe("ready");
    expect(ledger.ledgerState().entries.map((e) => e.coffee)).toEqual(["Kochere"]);
  });

  it("does not keep a token the server doesn't know", async () => {
    reply = () => ({ status: 401, body: { error: "no", unauthorized: true } });
    const ledger = await freshLedger();

    const result = await ledger.signIn(GOOD);
    expect(result.ok).toBe(false);
    expect(storage.has("coffeeLedger.token")).toBe(false);
  });

  it("starts from a clean slate when the token is a different one", async () => {
    storage.set("coffeeLedger.token", GOOD);
    let who = GOOD;
    reply = (call) =>
      call.url === "/api/session"
        ? { body: { ok: true } }
        : { body: { entries: [{ id: who === GOOD ? "mine" : "theirs", shots: [] }] } };
    const ledger = await freshLedger();
    await ledger.loadLedger();
    expect(ledger.ledgerState().entries.map((e) => e.id)).toEqual(["mine"]);

    who = OTHER;
    await ledger.signIn(OTHER);
    expect(ledger.ledgerState().entries.map((e) => e.id)).toEqual(["theirs"]);
  });
});

describe("making an account", () => {
  it("hands back the token without keeping it", async () => {
    reply = () => ({ status: 201, body: { token: GOOD } });
    const ledger = await freshLedger();

    expect(await ledger.createAccount()).toEqual({ token: GOOD });
    // Not this device's until it has been shown and confirmed.
    expect(storage.has("coffeeLedger.token")).toBe(false);
  });

  it("reports a deployment with no database instead of a token", async () => {
    reply = () => ({ status: 503, body: { error: "No database is connected.", needsSetup: true } });
    const ledger = await freshLedger();

    const made = await ledger.createAccount();
    expect(made).toEqual({ error: "No database is connected." });
    expect(ledger.ledgerState().needsSetup).toBe(true);
  });
});

describe("locking the device", () => {
  it("forgets the token and the ledger", async () => {
    storage.set("coffeeLedger.token", GOOD);
    reply = () => ({ body: { entries: [{ id: "a", shots: [] }] } });
    const ledger = await freshLedger();
    await ledger.loadLedger();
    expect(ledger.ledgerState().entries).toHaveLength(1);

    ledger.signOut();

    expect(storage.has("coffeeLedger.token")).toBe(false);
    expect(ledger.ledgerState().status).toBe("locked");
    expect(ledger.ledgerState().entries).toEqual([]);
  });

  it("does not send a half-typed change after the token is gone", async () => {
    storage.set("coffeeLedger.token", GOOD);
    reply = () => ({ body: { entries: [{ id: "a", coffee: "", shots: [] }] } });
    const ledger = await freshLedger();
    await ledger.loadLedger();
    calls = [];

    ledger.updateEntry("a", { coffee: "Kochere" }); // resting in the debounce
    ledger.signOut();
    await sleep(750); // past the 600ms hold

    expect(calls).toEqual([]);
    expect(ledger.ledgerState().unsaved).toBe(0);
  });
});

/* ------------------------------------------------------- choosing a token */

/** Signed in as GOOD with one coffee and a profile already on the server. */
async function signedIn(profile: Record<string, string> = {}) {
  storage.set("coffeeLedger.token", GOOD);
  reply = (call) => {
    if (call.url === "/api/entries" && call.method === "GET") {
      return { body: { entries: [{ id: "k", coffee: "Kochere", shots: [] }] } };
    }
    if (call.url === "/api/profile" && call.method === "GET") {
      return { body: { profile: { name: "Yash", ...profile } } };
    }
    if (call.url === "/api/session" && call.method === "PUT") {
      return { body: { ok: true, token: String(call.body.token).trim().toLowerCase().replace(/\s+/g, " ") } };
    }
    return {};
  };
  const ledger = await freshLedger();
  await ledger.loadLedger();
  calls = [];
  return ledger;
}

async function until(check: () => boolean, what: string, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe("changing the token", () => {
  it("refuses an unusable token without asking the server", async () => {
    const ledger = await signedIn();
    for (const bad of ["abc", "cl_reserved", "café crème"]) {
      const result = await ledger.changeToken(bad);
      expect(result.ok, bad).toBe(false);
    }
    expect(calls).toHaveLength(0);
    expect(storage.get("coffeeLedger.token")).toBe(GOOD);
  });

  it("switches this device to the new token and keeps the ledger on screen", async () => {
    const ledger = await signedIn();
    const result = await ledger.changeToken("Blue Moon Espresso");

    expect(result).toEqual({ ok: true, token: "blue moon espresso" });
    expect(calls).toEqual([
      expect.objectContaining({ method: "PUT", url: "/api/session", auth: `Bearer ${GOOD}` }),
    ]);
    expect(storage.get("coffeeLedger.token")).toBe("blue moon espresso");
    // The same person, so nothing is reset: no reload, coffees still there.
    expect(ledger.ledgerState().status).toBe("ready");
    expect(ledger.ledgerState().entries.map((e) => e.coffee)).toEqual(["Kochere"]);
  });

  it("sends what was being typed under the old token first, and later writes under the new", async () => {
    const ledger = await signedIn();
    ledger.updateEntry("k", { roaster: "Sey" }); // still inside the debounce

    await ledger.changeToken("blue moon espresso");
    ledger.updateEntry("k", { roaster: "Sey Coffee" });
    await until(() => ledger.ledgerState().unsaved === 0, "the second write");

    expect(calls.map((c) => [c.method, c.url, c.auth])).toEqual([
      ["POST", "/api/entries", `Bearer ${GOOD}`],
      ["PUT", "/api/session", `Bearer ${GOOD}`],
      ["POST", "/api/entries", "Bearer blue moon espresso"],
    ]);
    expect(calls[0].body.roaster).toBe("Sey");
    expect(calls[2].body.roaster).toBe("Sey Coffee");
  });

  it("holds writes made while the change is in flight, then sends them under the new token", async () => {
    const ledger = await signedIn();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init: RequestInit = {}) => {
      if (String(url) === "/api/session" && init.method === "PUT") await gate;
      return original(url as string, init);
    }) as typeof fetch;

    const changing = ledger.changeToken("blue moon espresso");
    await sleep(20);
    ledger.addShot("k"); // immediate write, made mid-change
    await sleep(50);
    expect(calls.filter((c) => c.url === "/api/shots")).toHaveLength(0); // held back

    release();
    await changing;
    await until(() => ledger.ledgerState().unsaved === 0, "the held shot");
    const shot = calls.find((c) => c.url === "/api/shots");
    expect(shot?.auth).toBe("Bearer blue moon espresso");
  });

  it("reports a token someone else has, and keeps the old one", async () => {
    const ledger = await signedIn();
    reply = (call) =>
      call.method === "PUT"
        ? { status: 409, body: { error: "That token is already someone's. Pick another." } }
        : {};
    const result = await ledger.changeToken("taken token");
    expect(result).toEqual({ ok: false, error: "That token is already someone's. Pick another." });
    expect(storage.get("coffeeLedger.token")).toBe(GOOD);
    expect(ledger.ledgerState().status).toBe("ready");
  });
});

/* ---------------------------------------------------------------- profile */

describe("the profile", () => {
  it("is loaded with the ledger", async () => {
    const ledger = await signedIn({ grinder: "Niche Zero" });
    expect(ledger.ledgerState().profile).toEqual({
      name: "Yash",
      machine: "",
      grinder: "Niche Zero",
      basket: "",
      other: "",
    });
  });

  it("is saved whole, once typing stops", async () => {
    const ledger = await signedIn();
    for (const typed of ["N", "Ni", "Niche", "Niche Zero"]) ledger.updateProfile({ grinder: typed });
    await until(() => ledger.ledgerState().unsaved === 0, "the profile write");

    const writes = calls.filter((c) => c.url === "/api/profile");
    expect(writes).toHaveLength(1);
    // The name goes too: the server stores a field left out as blank.
    expect(writes[0].body).toEqual({ name: "Yash", machine: "", grinder: "Niche Zero", basket: "", other: "" });
  });

  it("copies its gear onto a new coffee", async () => {
    const ledger = await signedIn({ machine: "Decent DE1", grinder: "Niche Zero", basket: "VST 18g" });
    const entry = ledger.addEntry({ ...ledger.EMPTY_ENTRY, coffee: "Gesha" });
    expect(entry).toMatchObject({ machine: "Decent DE1", grinder: "Niche Zero", basket: "VST 18g", other: "" });

    await until(() => ledger.ledgerState().unsaved === 0, "the coffee write");
    expect(calls.find((c) => c.url === "/api/entries")?.body).toMatchObject({
      coffee: "Gesha",
      machine: "Decent DE1",
      grinder: "Niche Zero",
    });
  });

  it("doesn't rewrite older coffees when the gear changes", async () => {
    const ledger = await signedIn({ grinder: "Niche Zero" });
    const before = ledger.addEntry({ ...ledger.EMPTY_ENTRY, coffee: "Before" });
    ledger.updateProfile({ grinder: "Zerno" });
    const after = ledger.addEntry({ ...ledger.EMPTY_ENTRY, coffee: "After" });

    const byName = Object.fromEntries(ledger.ledgerState().entries.map((e) => [e.coffee, e.grinder]));
    expect(byName).toMatchObject({ Before: "Niche Zero", After: "Zerno" });
    expect(before.grinder).toBe("Niche Zero");
    expect(after.grinder).toBe("Zerno");
  });

  it("is forgotten when the device is locked", async () => {
    const ledger = await signedIn({ grinder: "Niche Zero" });
    ledger.signOut();
    expect(ledger.ledgerState().profile).toEqual(ledger.EMPTY_PROFILE);
  });
});
