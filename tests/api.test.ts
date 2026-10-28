/** The serverless functions, run against a real Postgres.
 *
 *  PGlite is Postgres 18 compiled to wasm — the same planner, the same DDL,
 *  the same error codes — so the SQL in api/ is executed here rather than
 *  described. Only the transport is stubbed: `neon()` is swapped for a tagged
 *  template that runs the identical text and parameters against PGlite.
 *
 *  Identical is load-bearing, so the stub lives in tests/neon-stub.ts and
 *  tests/neon-contract.test.ts holds it against the real client — including
 *  that Neon sends every parameter as text over HTTP.
 *
 *  What this is really checking is the set of things a mocked database would
 *  have happily agreed to and Postgres won't: that the tables get created,
 *  that an upsert updates rather than duplicates, that created_at survives an
 *  edit, that deleting a coffee takes its shots with it, and that a shot
 *  can't be logged against a coffee that isn't there.
 *
 *  Every route needs a token, so each request here carries one; the tests that
 *  are about the token itself — and about one user not seeing another's
 *  coffees — are in "accounts" at the end. */

import { createHash } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({
  run: null as null | ((text: string, params: unknown[]) => Promise<Record<string, unknown>[]>),
}));

vi.mock("@neondatabase/serverless", async () => {
  const { toQuery } = await import("./neon-stub");
  return {
    neon: () =>
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        if (!holder.run) throw new Error("no database attached");
        const { query, params } = toQuery(strings, values);
        return holder.run(query, params);
      },
  };
});

type Handler = (req: any, res: any) => Promise<void> | void;
let entriesHandler: Handler;
let shotsHandler: Handler;
let sessionHandler: Handler;
let profileHandler: Handler;
let forgetSchema: () => void;
/** The user every test runs as unless it says otherwise. */
let token = "";
/** Taken off the module the handlers come from rather than imported at the top
 *  of this file: a static import would evaluate api/entries before beforeAll
 *  sets DATABASE_URL, and every handler test would then find no database. */
let findConnectionString: (env: NodeJS.ProcessEnv) => string;
let db: PGlite;

function call(handler: Handler, req: Partial<{ method: string; query: any; headers: any; body: any }>) {
  const sent: { status: number; body: any } = { status: 0, body: null };
  const res: any = {
    status(code: number) {
      sent.status = code;
      return res;
    },
    json(body: unknown) {
      sent.body = body;
    },
    setHeader() {},
  };
  return Promise.resolve(
    handler(
      { method: "GET", query: {}, headers: { authorization: `Bearer ${token}` }, ...req },
      res,
    ),
  ).then(() => sent);
}

const putEntry = (fields: Record<string, unknown>) =>
  call(entriesHandler, { method: "POST", body: fields });

const putShot = (entryId: string, shot: Record<string, unknown>) =>
  call(shotsHandler, { method: "POST", body: { entryId, shot } });

const readLedger = () => call(entriesHandler, { method: "GET" });

const as = (who: string) => ({ authorization: `Bearer ${who}` });

/** A new account, the way the app makes one. */
async function signUp(): Promise<string> {
  const made = await call(sessionHandler, { method: "POST", headers: {} });
  expect(made.status).toBe(201);
  return made.body.token as string;
}

beforeAll(async () => {
  db = await PGlite.create();
  holder.run = async (text, params) => (await db.query(text, params)).rows as Record<string, unknown>[];

  process.env.DATABASE_URL = "postgres://stub/stub";

  vi.resetModules();
  const entriesModule = await import("../api/entries");
  entriesHandler = entriesModule.default as Handler;
  findConnectionString = entriesModule.findConnectionString;
  forgetSchema = entriesModule.forgetSchema;
  shotsHandler = (await import("../api/shots")).default as Handler;
  sessionHandler = (await import("../api/session")).default as Handler;
  profileHandler = (await import("../api/profile")).default as Handler;

  // The first request is what creates the tables, and making an account is a
  // request — so by the time any test runs, the schema exists.
  token = await signUp();
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  // Coffees (and their shots) are cleared between tests; users are kept, so
  // `token` stays valid for the whole file.
  await db.query("delete from entries");
});

describe("the schema bootstraps itself", () => {
  it("creates the tables and the index on the first request", async () => {
    const first = await readLedger();
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ entries: [] });

    const tables = await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_name in ('users','entries','shots') order by 1",
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual(["entries", "shots", "users"]);

    const indexes = await db.query<{ indexname: string }>(
      "select indexname from pg_indexes where tablename = 'shots' order by 1",
    );
    expect(indexes.rows.map((r) => r.indexname)).toContain("shots_entry_id_created_at_idx");
  });

  it("gives every coffee an owner, and removes a user's coffees with the user", async () => {
    await putEntry({ id: "mine", coffee: "Mine" });
    const owned = await db.query<{ user_id: string | null }>("select user_id from entries");
    expect(owned.rows[0].user_id).toEqual(expect.any(String));

    await db.query("delete from users where id = $1", [owned.rows[0].user_id]);
    expect((await db.query("select 1 from entries")).rows).toHaveLength(0);
    // The shared token is gone with its user, so give the file a new one.
    token = await signUp();
  });

  it("declares the cascade rather than relying on the app to tidy up", async () => {
    await readLedger();
    const fk = await db.query<{ confdeltype: string }>(
      "select confdeltype from pg_constraint where conrelid = 'shots'::regclass and contype = 'f'",
    );
    expect(fk.rows[0].confdeltype).toBe("c"); // c = cascade
  });
});

describe("coffees", () => {
  it("stores every field and reads it back unchanged", async () => {
    const entry = {
      id: "kochere",
      createdAt: 1_700_000_000_000,
      coffee: "Kochere Natural",
      roaster: "Sey Coffee",
      origins: "Ethiopia",
      altitude: "1900",
      tastingNotes: "Blueberry, jasmine, dark chocolate",
      roastLevel: "Light",
      roastDate: "2026-08-01",
      process: "Natural",
      variety: "Heirloom",
      comments: "Second bag",
      machine: "Decent DE1",
      grinder: "Niche Zero",
      basket: "VST 18g",
      other: "Puck screen, WDT",
    };
    expect((await putEntry(entry)).status).toBe(200);

    const { body } = await readLedger();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toEqual({ ...entry, shots: [] });
  });

  it("fills in the columns a partial write left out, instead of failing", async () => {
    await putEntry({ id: "sparse", coffee: "Just a name" });
    const { body } = await readLedger();
    expect(body.entries[0].roaster).toBe("");
    expect(body.entries[0].tastingNotes).toBe("");
  });

  it("replaces on a second write rather than duplicating", async () => {
    await putEntry({ id: "kochere", coffee: "Kochere", roaster: "Sey" });
    await putEntry({ id: "kochere", coffee: "Kochere Natural", roaster: "Sey" });

    const { body } = await readLedger();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].coffee).toBe("Kochere Natural");
  });

  it("does not move a coffee up the ledger when a typo in it is fixed", async () => {
    await putEntry({ id: "old", createdAt: 1_600_000_000_000, coffee: "Old bag" });
    await putEntry({ id: "new", createdAt: 1_700_000_000_000, coffee: "New bag" });
    expect((await readLedger()).body.entries.map((e: any) => e.id)).toEqual(["new", "old"]);

    await putEntry({ id: "old", createdAt: Date.now(), coffee: "Old bag, corrected" });

    const { body } = await readLedger();
    expect(body.entries.map((e: any) => e.id)).toEqual(["new", "old"]);
    expect(body.entries[1].createdAt).toBe(1_600_000_000_000);
  });

  it("moves updated_at even though created_at stays put", async () => {
    await putEntry({ id: "a", coffee: "One" });
    const before = await db.query<{ u: Date }>("select updated_at as u from entries");
    await new Promise((r) => setTimeout(r, 15));
    await putEntry({ id: "a", coffee: "Two" });
    const after = await db.query<{ u: Date }>("select updated_at as u from entries");
    expect(new Date(after.rows[0].u).getTime()).toBeGreaterThan(
      new Date(before.rows[0].u).getTime(),
    );
  });

  it("deletes, and says so when there was nothing to delete", async () => {
    await putEntry({ id: "a", coffee: "One" });
    expect((await call(entriesHandler, { method: "DELETE", query: { id: "a" } })).status).toBe(200);
    expect((await readLedger()).body.entries).toEqual([]);
    expect((await call(entriesHandler, { method: "DELETE", query: { id: "a" } })).status).toBe(404);
  });
});

describe("shots", () => {
  beforeEach(async () => {
    await putEntry({ id: "kochere", coffee: "Kochere" });
  });

  it("hangs a shot off its coffee and reads it back exactly", async () => {
    const shot = {
      id: "s1",
      starred: true,
      grind: "3.2",
      dose: "18.2",
      yield: "41",
      timeMin: "0",
      timeSec: "28",
      rpm: "1200",
      temp: "93",
      infusion: "8",
      ps: true,
      extraction: 62,
      notes: "Best so far",
      pulledAt: 1_700_000_000_123,
    };
    expect((await putShot("kochere", shot)).status).toBe(200);

    const { body } = await readLedger();
    // Exactly, to the millisecond it was pulled.
    expect(body.entries[0].shots).toEqual([shot]);
  });

  it("keeps a shot that hasn't been tasted as not tasted", async () => {
    await putShot("kochere", { id: "s1", dose: "18", extraction: null });
    const [stored] = (await readLedger()).body.entries[0].shots;
    expect(stored.extraction).toBeNull();
    // And tasting it later sets it.
    await putShot("kochere", { ...stored, extraction: 30 });
    expect((await readLedger()).body.entries[0].shots[0].extraction).toBe(30);
  });

  it("orders the log by when shots were pulled, so a restored shot goes back in its place", async () => {
    await putShot("kochere", { id: "first", pulledAt: 1_000_000 });
    await putShot("kochere", { id: "third", pulledAt: 3_000_000 });
    // Deleted and restored: written last, but pulled second.
    await putShot("kochere", { id: "second", pulledAt: 2_000_000 });
    expect((await readLedger()).body.entries[0].shots.map((s: any) => s.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("never moves a shot's pull time when it's edited", async () => {
    await putShot("kochere", { id: "s1", pulledAt: 1_000_000 });
    await putShot("kochere", { id: "s1", dose: "18.4", pulledAt: 9_000_000 });
    const [stored] = (await readLedger()).body.entries[0].shots;
    expect(stored.dose).toBe("18.4");
    expect(stored.pulledAt).toBe(1_000_000);
  });

  it("keeps the shot log in the order the shots were pulled", async () => {
    for (const id of ["s1", "s2", "s3"]) await putShot("kochere", { id, notes: id });
    expect((await readLedger()).body.entries[0].shots.map((s: any) => s.id)).toEqual([
      "s1",
      "s2",
      "s3",
    ]);
  });

  it("does not move a shot to the bottom of the log when it is corrected", async () => {
    for (const id of ["s1", "s2", "s3"]) await putShot("kochere", { id });
    await new Promise((r) => setTimeout(r, 15));
    await putShot("kochere", { id: "s1", dose: "18.4" });

    const shots = (await readLedger()).body.entries[0].shots;
    expect(shots.map((s: any) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(shots[0].dose).toBe("18.4");
  });

  it("keeps a blank measurement blank instead of turning it into a zero", async () => {
    await putShot("kochere", { id: "s1", dose: "", yield: "~41", temp: "93.5" });
    const shot = (await readLedger()).body.entries[0].shots[0];
    expect(shot.dose).toBe("");
    expect(shot.yield).toBe("~41");
    expect(shot.temp).toBe("93.5");
  });

  it("stores extraction as an integer on the slider's scale", async () => {
    await putShot("kochere", { id: "s1", extraction: 900 });
    await putShot("kochere", { id: "s2", extraction: -5 });
    await putShot("kochere", { id: "s3", extraction: 61.6 });
    const shots = (await readLedger()).body.entries[0].shots;
    expect(shots.map((s: any) => s.extraction)).toEqual([100, 0, 62]);
  });

  it("sorts each coffee's shots under that coffee and no other", async () => {
    await putEntry({ id: "other", coffee: "Other" });
    await putShot("kochere", { id: "s1" });
    await putShot("other", { id: "s2" });

    const byId = Object.fromEntries(
      (await readLedger()).body.entries.map((e: any) => [e.id, e.shots.map((s: any) => s.id)]),
    );
    expect(byId).toEqual({ kochere: ["s1"], other: ["s2"] });
  });

  it("refuses a shot for a coffee that isn't there, as gone rather than broken", async () => {
    const sent = await putShot("vanished", { id: "s1" });
    expect(sent.status).toBe(409);
    expect(sent.body.error).toMatch(/no longer in the ledger/);
  });

  it("goes with the coffee when the coffee is deleted", async () => {
    await putShot("kochere", { id: "s1" });
    await putShot("kochere", { id: "s2" });
    expect((await db.query("select * from shots")).rows).toHaveLength(2);

    await call(entriesHandler, { method: "DELETE", query: { id: "kochere" } });
    expect((await db.query("select * from shots")).rows).toHaveLength(0);
  });

  it("deletes one shot, and says so when there was nothing to delete", async () => {
    await putShot("kochere", { id: "s1" });
    expect((await call(shotsHandler, { method: "DELETE", query: { id: "s1" } })).status).toBe(200);
    expect((await readLedger()).body.entries[0].shots).toEqual([]);
    expect((await call(shotsHandler, { method: "DELETE", query: { id: "s1" } })).status).toBe(404);
  });
});

describe("what the routes refuse", () => {
  it("refuses an id it would have to quote", async () => {
    expect((await putEntry({ id: "has spaces" })).status).toBe(400);
    expect((await putEntry({ coffee: "no id at all" })).status).toBe(400);
    expect((await putShot("kochere", { id: "" })).status).toBe(400);
    expect((await call(shotsHandler, { method: "POST", body: { shot: { id: "s" } } })).status).toBe(400);
  });

  it("refuses a body big enough to be a problem", async () => {
    const sent = await putEntry({ id: "huge", comments: "x".repeat(250_000) });
    expect(sent.status).toBe(413);
    expect((await readLedger()).body.entries).toHaveLength(0);
  });

  it("refuses a method it doesn't have", async () => {
    expect((await call(entriesHandler, { method: "PUT" })).status).toBe(405);
    expect((await call(shotsHandler, { method: "GET" })).status).toBe(405);
  });

  it("treats a value that looks like SQL as a value", async () => {
    const nasty = "'); drop table entries; --";
    await putEntry({ id: "sneaky", coffee: nasty, comments: "Robert'); DROP TABLE shots;--" });
    await putShot("sneaky", { id: "s1", notes: nasty });

    const { body } = await readLedger();
    expect(body.entries[0].coffee).toBe(nasty);
    expect(body.entries[0].shots[0].notes).toBe(nasty);
    // Both tables are still standing.
    expect((await db.query("select 1 from entries")).rows).toHaveLength(1);
    expect((await db.query("select 1 from shots")).rows).toHaveLength(1);
  });

  it("keeps unicode and emoji intact", async () => {
    await putEntry({ id: "unicode", coffee: "Café Náriño ☕️", tastingNotes: "🫐 jasmine" });
    const entry = (await readLedger()).body.entries[0];
    expect(entry.coffee).toBe("Café Náriño ☕️");
    expect(entry.tastingNotes).toBe("🫐 jasmine");
  });
});

describe("accounts", () => {
  it("issues a token of the expected shape, and a different one each time", async () => {
    const a = await signUp();
    const b = await signUp();
    expect(a).toMatch(/^cl_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("stores a fingerprint of the token and never the token", async () => {
    const issued = await signUp();
    const rows = await db.query<{ token_hash: string }>("select token_hash from users");
    const hashes = rows.rows.map((r) => r.token_hash);

    expect(hashes).toContain(createHash("sha256").update(issued).digest("hex"));
    expect(JSON.stringify(rows.rows)).not.toContain(issued);
    expect(JSON.stringify((await db.query("select * from users")).rows)).not.toContain(issued);
  });

  it("answers GET /api/session for a good token and 401 for anything else", async () => {
    expect((await call(sessionHandler, { method: "GET" })).status).toBe(200);
    expect((await call(sessionHandler, { method: "GET", headers: {} })).status).toBe(401);
    expect(
      (await call(sessionHandler, { method: "GET", headers: as("cl_" + "x".repeat(43)) })).status,
    ).toBe(401);
    expect((await call(sessionHandler, { method: "GET", headers: as("nonsense") })).status).toBe(401);
    expect((await call(sessionHandler, { method: "DELETE" })).status).toBe(405);
  });

  describe("every route wants a token", () => {
    const stranger = "cl_" + "z".repeat(43);
    // Thunks: the handlers are only assigned once beforeAll has run, which is
    // after this table is built.
    const attempts: [string, () => Handler, any][] = [
      ["GET /api/entries", () => entriesHandler, { method: "GET" }],
      ["POST /api/entries", () => entriesHandler, { method: "POST", body: { id: "x" } }],
      ["DELETE /api/entries", () => entriesHandler, { method: "DELETE", query: { id: "x" } }],
      ["POST /api/shots", () => shotsHandler, { method: "POST", body: { entryId: "x", shot: { id: "s" } } }],
      ["DELETE /api/shots", () => shotsHandler, { method: "DELETE", query: { id: "s" } }],
      ["GET /api/profile", () => profileHandler, { method: "GET" }],
      ["POST /api/profile", () => profileHandler, { method: "POST", body: { name: "x" } }],
      ["PUT /api/session", () => sessionHandler, { method: "PUT", body: { token: "sneaky token" } }],
    ];

    it.each(attempts)("%s: refused with no header", async (_name, handlerOf, req) => {
      const sent = await call(handlerOf(), { ...req, headers: {} });
      expect(sent.status).toBe(401);
      expect(sent.body.unauthorized).toBe(true);
    });

    it.each(attempts)("%s: refused with a well-formed token nobody holds", async (_name, handlerOf, req) => {
      expect((await call(handlerOf(), { ...req, headers: as(stranger) })).status).toBe(401);
    });

    it.each(attempts)("%s: refused with a malformed token", async (_name, handlerOf, req) => {
      expect((await call(handlerOf(), { ...req, headers: as("hunter2") })).status).toBe(401);
      expect((await call(handlerOf(), { ...req, headers: { authorization: token } })).status).toBe(401);
    });

    it("writes nothing when it refuses", async () => {
      await call(entriesHandler, { method: "POST", body: { id: "sneak" }, headers: {} });
      expect((await db.query("select 1 from entries")).rows).toHaveLength(0);
    });

    it("accepts the scheme in any case", async () => {
      const sent = await call(entriesHandler, {
        method: "GET",
        headers: { authorization: `bearer ${token}` },
      });
      expect(sent.status).toBe(200);
    });
  });

  describe("one ledger per token", () => {
    let other = "";
    beforeEach(async () => {
      other = await signUp();
    });

    const readAs = (who: string) => call(entriesHandler, { method: "GET", headers: as(who) });

    it("shows each person only their own coffees and shots", async () => {
      await putEntry({ id: "mine", coffee: "Mine" });
      await putShot("mine", { id: "s1", notes: "mine" });
      await call(entriesHandler, { method: "POST", headers: as(other), body: { id: "theirs", coffee: "Theirs" } });
      await call(shotsHandler, {
        method: "POST",
        headers: as(other),
        body: { entryId: "theirs", shot: { id: "s2", notes: "theirs" } },
      });

      const mine = (await readLedger()).body.entries;
      const theirs = (await readAs(other)).body.entries;
      expect(mine.map((e: any) => e.id)).toEqual(["mine"]);
      expect(mine[0].shots.map((s: any) => s.id)).toEqual(["s1"]);
      expect(theirs.map((e: any) => e.id)).toEqual(["theirs"]);
      expect(theirs[0].shots.map((s: any) => s.id)).toEqual(["s2"]);
    });

    it("starts a new account with an empty ledger", async () => {
      await putEntry({ id: "mine" });
      expect((await readAs(other)).body).toEqual({ entries: [] });
    });

    it("won't let someone else delete a coffee, and says it isn't there", async () => {
      await putEntry({ id: "mine", coffee: "Mine" });
      const sent = await call(entriesHandler, { method: "DELETE", headers: as(other), query: { id: "mine" } });
      expect(sent.status).toBe(404);
      expect((await readLedger()).body.entries).toHaveLength(1);
    });

    it("won't let someone overwrite a coffee by reusing its id", async () => {
      await putEntry({ id: "mine", coffee: "Mine" });
      const sent = await call(entriesHandler, {
        method: "POST",
        headers: as(other),
        body: { id: "mine", coffee: "Hijacked" },
      });
      expect(sent.status).toBe(409);
      expect((await readLedger()).body.entries[0].coffee).toBe("Mine");
      expect((await readAs(other)).body.entries).toEqual([]);
    });

    it("won't let someone log a shot against a coffee that isn't theirs", async () => {
      await putEntry({ id: "mine" });
      const sent = await call(shotsHandler, {
        method: "POST",
        headers: as(other),
        body: { entryId: "mine", shot: { id: "intruder" } },
      });
      expect(sent.status).toBe(409);
      expect((await readLedger()).body.entries[0].shots).toEqual([]);
    });

    it("won't let someone overwrite or delete a shot that isn't theirs", async () => {
      await putEntry({ id: "mine" });
      await putShot("mine", { id: "s1", dose: "18" });
      await call(entriesHandler, { method: "POST", headers: as(other), body: { id: "theirs" } });

      const overwrite = await call(shotsHandler, {
        method: "POST",
        headers: as(other),
        body: { entryId: "theirs", shot: { id: "s1", dose: "99" } },
      });
      expect(overwrite.status).toBe(409);

      const removal = await call(shotsHandler, { method: "DELETE", headers: as(other), query: { id: "s1" } });
      expect(removal.status).toBe(404);

      const shots = (await readLedger()).body.entries[0].shots;
      expect(shots).toHaveLength(1);
      expect(shots[0].dose).toBe("18");
    });

    it("still lets the owner edit and delete their own", async () => {
      await putEntry({ id: "mine", coffee: "One" });
      await putShot("mine", { id: "s1", dose: "18" });
      expect((await putEntry({ id: "mine", coffee: "Two" })).status).toBe(200);
      expect((await putShot("mine", { id: "s1", dose: "19" })).status).toBe(200);
      expect((await readLedger()).body.entries[0].shots[0].dose).toBe("19");
      expect((await call(shotsHandler, { method: "DELETE", query: { id: "s1" } })).status).toBe(200);
      expect((await call(entriesHandler, { method: "DELETE", query: { id: "mine" } })).status).toBe(200);
    });
  });
});

/** Connecting Neon in the Vercel dashboard is the whole of the setup, so what
 *  it hands you has to be found without being told where to look. The
 *  integration writes DATABASE_URL by default, but the connect dialog offers a
 *  custom prefix, and a project carried over from the old Vercel Postgres has
 *  POSTGRES_URL instead.
 *
 *  Tested as a pure function against an explicit environment. Reloading the
 *  module with a doctored process.env looks more end-to-end and isn't:
 *  the connection string is resolved once at import, and vi.resetModules does
 *  not reliably re-evaluate a module that has been mocked — the negative case
 *  passed by keeping the previous test's value. */
describe("finding the database it was given", () => {
  it.each([
    ["DATABASE_URL", "what the Vercel Neon integration sets by default"],
    ["POSTGRES_URL", "a project carried over from Vercel Postgres"],
    ["STORAGE_URL", "the storage-prefixed spelling"],
    ["DATABASE_URL_UNPOOLED", "Neon's direct connection"],
    ["COFFEE_LEDGER_URL", "a custom prefix chosen in the connect dialog"],
    ["SOMETHING_NOBODY_PREDICTED_URL", "a prefix nobody could have predicted"],
  ])("finds the URL when it arrives as %s (%s)", (name) => {
    expect(findConnectionString({ [name]: "postgres://u:p@host/db" })).toBe(
      "postgres://u:p@host/db",
    );
  });

  it("accepts the postgresql:// spelling", () => {
    expect(findConnectionString({ DATABASE_URL: "postgresql://u:p@host/db" })).toBe(
      "postgresql://u:p@host/db",
    );
  });

  it("prefers the documented names over a stray match", () => {
    expect(
      findConnectionString({
        AAA_URL: "postgres://stray/db",
        DATABASE_URL: "postgres://real/db",
      }),
    ).toBe("postgres://real/db");
  });

  it("ignores a variable that ends in _URL but isn't a database", () => {
    // VERCEL_URL is set on every deployment; taking it would turn "no database
    // connected" into a confusing connection failure.
    expect(
      findConnectionString({
        VERCEL_URL: "https://coffee-ledger.vercel.app",
        NEXT_PUBLIC_SITE_URL: "https://example.com",
        REDIS_URL: "redis://localhost:6379",
      }),
    ).toBe("");
  });

  it("finds nothing in an empty environment", () => {
    expect(findConnectionString({})).toBe("");
  });
});

describe("with nothing connected", () => {
  it("says the deployment has no database rather than pretending to save", async () => {
    const saved = { ...process.env };
    for (const name of Object.keys(process.env)) {
      if (name.endsWith("_URL")) delete process.env[name];
    }
    vi.resetModules();
    const bare = (await import("../api/entries")).default as Handler;

    const sent = await call(bare, { method: "GET" });
    expect(sent.status).toBe(503);
    expect(sent.body.needsSetup).toBe(true);
    expect(sent.body.lookedFor).toContain("DATABASE_URL");
    // The names it looked for, never a value.
    expect(JSON.stringify(sent.body)).not.toContain("stub");

    process.env = saved;
    vi.resetModules();
    // Every handle on the module, not just the handlers: a stale forgetSchema
    // would reset the old module's memo while requests go to the new one, and
    // a later upgrade test would silently run against an un-upgraded schema.
    const entriesModule = await import("../api/entries");
    entriesHandler = entriesModule.default as Handler;
    findConnectionString = entriesModule.findConnectionString;
    forgetSchema = entriesModule.forgetSchema;
    shotsHandler = (await import("../api/shots")).default as Handler;
    sessionHandler = (await import("../api/session")).default as Handler;
    profileHandler = (await import("../api/profile")).default as Handler;
  });
});

/* ------------------------------------------------------- memorable tokens */

const changeToken = (as_: string, next: unknown) =>
  call(sessionHandler, { method: "PUT", headers: as(as_), body: { token: next } });

const ledgerOf = (who: string) => call(entriesHandler, { method: "GET", headers: as(who) });

describe("choosing a memorable token", () => {
  it("swaps the issued token for a chosen one: the old stops, the new opens the same ledger", async () => {
    const issued = await signUp();
    await call(entriesHandler, {
      method: "POST",
      headers: as(issued),
      body: { id: "mine", coffee: "Kochere" },
    });

    const changed = await changeToken(issued, "blue moon coffee");
    expect(changed.status).toBe(200);
    expect(changed.body.token).toBe("blue moon coffee");

    expect((await ledgerOf(issued)).status).toBe(401);
    const opened = await ledgerOf("blue moon coffee");
    expect(opened.status).toBe(200);
    expect(opened.body.entries.map((e: any) => e.coffee)).toEqual(["Kochere"]);
  });

  it("isn't case-sensitive and forgives the spaces a phone keyboard adds", async () => {
    const issued = await signUp();
    await changeToken(issued, "Yash Espresso");
    for (const typed of ["yash espresso", "YASH ESPRESSO", "  Yash   Espresso ", "yash espresso "]) {
      expect((await ledgerOf(typed)).status, typed).toBe(200);
    }
  });

  it("hands back the tidied form, which is what the device should keep", async () => {
    const issued = await signUp();
    expect((await changeToken(issued, "  Atharva   Pulls  ")).body.token).toBe("atharva pulls");
  });

  it("stores only a fingerprint of the chosen token", async () => {
    const issued = await signUp();
    await changeToken(issued, "remember me please");
    const dump = JSON.stringify((await db.query("select * from users")).rows);
    expect(dump).not.toContain("remember me please");
    expect(dump).toContain(createHash("sha256").update("remember me please").digest("hex"));
  });

  it("keeps issued tokens exact — case is part of a random token", async () => {
    const issued = await signUp();
    const flipped = issued.replace(/[A-Za-z]/g, (c) =>
      c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase(),
    );
    expect((await ledgerOf(issued)).status).toBe(200);
    if (flipped !== issued) expect((await ledgerOf(flipped)).status).toBe(401);
  });

  it("refuses a token another person already has, and changes nothing", async () => {
    const yash = await signUp();
    const atharva = await signUp();
    expect((await changeToken(yash, "shared morning")).status).toBe(200);

    const clash = await changeToken(atharva, "Shared Morning");
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatch(/already someone's/);

    // Both still open their own ledgers with what they had.
    expect((await ledgerOf("shared morning")).status).toBe(200);
    expect((await ledgerOf(atharva)).status).toBe(200);
  });

  it("allows setting the token you already have", async () => {
    const issued = await signUp();
    await changeToken(issued, "same again");
    expect((await changeToken("same again", "Same Again")).status).toBe(200);
    expect((await ledgerOf("same again")).status).toBe(200);
  });

  it.each([
    ["short", "too short"],
    ["x".repeat(65), "too long"],
    ["café crème", "not ASCII — a browser won't send it in a header"],
    ["cl_mine_now", "reserved for generated tokens"],
    ["", "empty"],
    [42, "not a string"],
  ])("refuses %j (%s) and leaves the old token working", async (next) => {
    const issued = await signUp();
    const sent = await changeToken(issued, next);
    expect(sent.status).toBe(400);
    expect(typeof sent.body.error).toBe("string");
    expect((await ledgerOf(issued)).status).toBe(200);
  });

  it("can't be done without the current token", async () => {
    expect((await call(sessionHandler, { method: "PUT", headers: {}, body: { token: "takeover1" } })).status).toBe(401);
    expect((await changeToken("cl_" + "q".repeat(43), "takeover2")).status).toBe(401);
    expect((await ledgerOf("takeover1")).status).toBe(401);
    expect((await ledgerOf("takeover2")).status).toBe(401);
  });
});

/* --------------------------------------------------------------- profiles */

const profileOf = (who: string) => call(profileHandler, { method: "GET", headers: as(who) });
const saveProfile = (who: string, body: unknown) =>
  call(profileHandler, { method: "POST", headers: as(who), body });

describe("profiles", () => {
  it("starts blank", async () => {
    const issued = await signUp();
    const sent = await profileOf(issued);
    expect(sent.status).toBe(200);
    expect(sent.body.profile).toEqual({ name: "", machine: "", grinder: "", basket: "", other: "" });
  });

  it("keeps a name and gear, and reads them back", async () => {
    const issued = await signUp();
    const gear = {
      name: "Yash",
      machine: "Decent DE1",
      grinder: "Niche Zero",
      basket: "VST 18g",
      other: "Puck screen, WDT",
    };
    expect((await saveProfile(issued, gear)).body.profile).toEqual(gear);
    expect((await profileOf(issued)).body.profile).toEqual(gear);
  });

  it("follows the person through a token change", async () => {
    const issued = await signUp();
    await saveProfile(issued, { name: "Atharva", grinder: "Comandante" });
    await changeToken(issued, "atharva grinds");
    expect((await profileOf("atharva grinds")).body.profile).toMatchObject({
      name: "Atharva",
      grinder: "Comandante",
    });
  });

  it("is one person's: someone else's profile is invisible and untouchable", async () => {
    const yash = await signUp();
    const atharva = await signUp();
    await saveProfile(yash, { name: "Yash", machine: "Decent DE1" });
    await saveProfile(atharva, { name: "Atharva", machine: "Lelit Bianca" });

    expect((await profileOf(yash)).body.profile).toMatchObject({ name: "Yash", machine: "Decent DE1" });
    expect((await profileOf(atharva)).body.profile).toMatchObject({ name: "Atharva", machine: "Lelit Bianca" });
  });

  it("stores what it's sent whole — a field left out is stored blank", async () => {
    const issued = await signUp();
    await saveProfile(issued, { name: "Yash", grinder: "Niche Zero" });
    const sent = await saveProfile(issued, { grinder: "Zerno" });
    expect(sent.body.profile).toEqual({ name: "", machine: "", grinder: "Zerno", basket: "", other: "" });
  });

  it("refuses a field long enough to be something other than gear", async () => {
    const issued = await signUp();
    const sent = await saveProfile(issued, { name: "Yash", other: "x".repeat(201) });
    expect(sent.status).toBe(413);
    expect((await profileOf(issued)).body.profile.name).toBe("");
  });

  it("answers 405 to a method it doesn't have", async () => {
    expect((await call(profileHandler, { method: "DELETE" })).status).toBe(405);
  });

  it("upgrades a users table made before profiles existed", async () => {
    // A database exactly as main's first token release left it: users with no
    // profile columns, and someone already in it.
    const old = await PGlite.create();
    const known = "cl_" + "a".repeat(43);
    await old.exec(`
      create table users (id text primary key, token_hash text not null unique,
                          created_at timestamptz not null default now());
      insert into users (id, token_hash) values ('before', '${createHash("sha256").update(known).digest("hex")}');
    `);

    const runOnMain = holder.run;
    holder.run = async (text, params) => (await old.query(text, params)).rows as Record<string, unknown>[];
    forgetSchema();
    try {
      expect((await profileOf(known)).body.profile).toEqual({
        name: "",
        machine: "",
        grinder: "",
        basket: "",
        other: "",
      });
      expect((await saveProfile(known, { name: "Early", grinder: "EK43" })).status).toBe(200);
      const columns = await old.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_name = 'users' order by 1",
      );
      expect(columns.rows.map((c) => c.column_name)).toEqual(
        expect.arrayContaining(["name", "machine", "grinder", "basket", "other"]),
      );
    } finally {
      holder.run = runOnMain;
      forgetSchema();
      await old.close();
    }
  });
});

describe("upgrading the shots table", () => {
  it("lets an existing NOT NULL taste column hold 'not tasted'", async () => {
    const old = await PGlite.create();
    const known = "cl_" + "b".repeat(43);
    await old.exec(`
      create table users (id text primary key, token_hash text not null unique,
                          created_at timestamptz not null default now());
      insert into users (id, token_hash) values ('u', '${createHash("sha256").update(known).digest("hex")}');
      create table entries (id text primary key, coffee text not null default '', roaster text not null default '',
        origins text not null default '', altitude text not null default '', tasting_notes text not null default '',
        roast_level text not null default '', roast_date text not null default '', process text not null default '',
        variety text not null default '', comments text not null default '', machine text not null default '',
        grinder text not null default '', basket text not null default '', other text not null default '',
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        user_id text references users (id) on delete cascade);
      create table shots (id text primary key, entry_id text not null references entries (id) on delete cascade,
        starred boolean not null default false, grind text not null default '', dose text not null default '',
        yield_grams text not null default '', time_min text not null default '', time_sec text not null default '',
        rpm text not null default '', temp text not null default '', infusion text not null default '',
        pre_soak boolean not null default false, extraction integer not null default 50,
        notes text not null default '', created_at timestamptz not null default now(),
        updated_at timestamptz not null default now());
      insert into entries (id, coffee, user_id) values ('e', 'Old bag', 'u');
      insert into shots (id, entry_id, dose) values ('old', 'e', '18');
    `);

    const runOnMain = holder.run;
    holder.run = async (text, params) => (await old.query(text, params)).rows as Record<string, unknown>[];
    forgetSchema();
    try {
      const sent = await call(shotsHandler, {
        method: "POST",
        headers: as(known),
        body: { entryId: "e", shot: { id: "new", dose: "18.5", extraction: null } },
      });
      expect(sent.status).toBe(200);
      const shots = (await call(entriesHandler, { method: "GET", headers: as(known) })).body.entries[0].shots;
      // The shot logged before the change keeps the 50 it was stored with.
      expect(shots.map((s: any) => [s.id, s.extraction])).toEqual([
        ["old", 50],
        ["new", null],
      ]);
    } finally {
      holder.run = runOnMain;
      forgetSchema();
      await old.close();
    }
  });
});
