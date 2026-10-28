/** /api/entries — the ledger itself, in Postgres.
 *
 *  GET    → { entries }   every coffee, newest first, each with its shot log
 *  POST   → { entry }     add or replace one coffee, by id (shots untouched)
 *  DELETE → ?id=…         remove a coffee and every shot logged against it
 *
 *  Shots are written one at a time through /api/shots, which imports the
 *  connection from here. Two routes rather than one whole-ledger document
 *  because the shot log is the point of the thing: editing a dose should write
 *  that dose, not re-post every bag you own — and rows mean a later "every
 *  starred shot on the Niche" is a query, not a scan in JS.
 *
 *  Every route needs `Authorization: Bearer <token>`. A token names one user
 *  and a user owns their own coffees: every query below is scoped to the user
 *  the token resolves to, so one person's ledger is invisible to another's.
 *  Tokens come from POST /api/session — and can be swapped for a memorable
 *  one with PUT /api/session — and only their SHA-256 is stored. */

import { createHash, randomBytes } from "node:crypto";

import { neon } from "@neondatabase/serverless";

// The .js extension is deliberate and load-bearing: the build compiles these
// to .js and the package is "type": "module", where an extensionless specifier
// does not resolve at runtime. tsc and Vite both map it back to the .ts source.
import {
  MAX_ENTRY_BYTES,
  toEntry,
  type Entry,
  type Shot,
} from "../src/lib/ledger-types.js";
import { normalizeToken } from "../src/lib/tokens.js";

export type Req = {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};
export type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

/** Vercel's Neon integration sets DATABASE_URL by default, but the connection
 *  dialog offers a custom prefix, and a project carried over from the old
 *  Vercel Postgres has POSTGRES_URL. Rather than depend on one spelling, take
 *  the first that looks like a Postgres connection string. */
export const CONNECTION_VARS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "STORAGE_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
];

const isPostgresUrl = (value: string | undefined) =>
  typeof value === "string" && /^postgres(ql)?:\/\//i.test(value);

/** Takes the environment rather than reading it, so the lookup that the
 *  one-click setup depends on can be tested as the pure thing it is. */
export function findConnectionString(env: NodeJS.ProcessEnv = process.env): string {
  for (const name of CONNECTION_VARS) {
    if (isPostgresUrl(env[name])) return env[name] as string;
  }
  // A custom prefix produces something like MYPREFIX_URL, so fall back to any
  // variable at all whose value is a Postgres URL. The value is what decides,
  // not the name — VERCEL_URL ends in _URL too and is not a database.
  for (const [name, value] of Object.entries(env)) {
    if (name.endsWith("_URL") && isPostgresUrl(value)) return value as string;
  }
  return "";
}

const connectionString = findConnectionString();

export type Sql = ReturnType<typeof neon<false, false>>;

/** Created on first use rather than through a migration tool. There are two
 *  tables and they are additive-only, so a migration step would be more
 *  machinery than the thing it manages. The promise is memoised, so the round
 *  trip happens once per cold start rather than once per request.
 *
 *  Both "yield" and "time" read as SQL keywords and would want quoting
 *  everywhere, hence yield_grams and time_min/time_sec — which is what the
 *  columns hold anyway. */
let schemaReady: Promise<void> | null = null;

function ensureSchema(sql: Sql): Promise<void> {
  schemaReady ??= (async () => {
    // Only the hash of a token is kept, so a copy of this table is not a set
    // of working keys.
    await sql`
      create table if not exists users (
        id         text primary key,
        token_hash text        not null unique,
        created_at timestamptz not null default now()
      )
    `;
    // The profile: a name, and the gear that used to be typed into every new
    // coffee. Added in place so a database made before profiles existed
    // upgrades on its next cold start, with every existing user blank.
    await sql`
      alter table users
        add column if not exists name    text not null default '',
        add column if not exists machine text not null default '',
        add column if not exists grinder text not null default '',
        add column if not exists basket  text not null default '',
        add column if not exists other   text not null default ''
    `;
    await sql`
      create table if not exists entries (
        id            text primary key,
        coffee        text        not null default '',
        roaster       text        not null default '',
        origins       text        not null default '',
        altitude      text        not null default '',
        tasting_notes text        not null default '',
        roast_level   text        not null default '',
        roast_date    text        not null default '',
        process       text        not null default '',
        variety       text        not null default '',
        comments      text        not null default '',
        machine       text        not null default '',
        grinder       text        not null default '',
        basket        text        not null default '',
        other         text        not null default '',
        created_at    timestamptz not null default now(),
        updated_at    timestamptz not null default now()
      )
    `;
    await sql`
      create table if not exists shots (
        id         text primary key,
        entry_id   text        not null references entries (id) on delete cascade,
        starred    boolean     not null default false,
        grind      text        not null default '',
        dose       text        not null default '',
        yield_grams text       not null default '',
        time_min   text        not null default '',
        time_sec   text        not null default '',
        rpm        text        not null default '',
        temp       text        not null default '',
        infusion   text        not null default '',
        pre_soak   boolean     not null default false,
        extraction integer     not null default 50,
        notes      text        not null default '',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;
    // Added after the fact so a database created before accounts existed
    // upgrades in place. It is nullable for the same reason: a row with no
    // owner is never returned by any query, rather than breaking the upgrade.
    await sql`
      alter table entries
        add column if not exists user_id text references users (id) on delete cascade
    `;
    await sql`
      create index if not exists entries_user_id_created_at_idx
        on entries (user_id, created_at desc)
    `;
    // The bag: its size, its rest window, a weigh-in, and when it was
    // finished. Added in place; every existing coffee starts with none of it,
    // which reads as "untracked" and "still in use".
    await sql`
      alter table entries
        add column if not exists bag_grams     text not null default '',
        add column if not exists rest_from     text not null default '',
        add column if not exists rest_to       text not null default '',
        add column if not exists weighed_grams text not null default '',
        add column if not exists weighed_at    timestamptz,
        add column if not exists finished_at   timestamptz
    `;
    // "Not tasted yet" is null now. It used to default to 50, which read as
    // balanced. Dropping NOT NULL is a no-op the second time round.
    await sql`alter table shots alter column extraction drop not null`;
    // Every read is "the shots for these entries, in the order they were
    // pulled", so that is what the index covers.
    await sql`
      create index if not exists shots_entry_id_created_at_idx
        on shots (entry_id, created_at)
    `;
  })();
  return schemaReady;
}

/** A failed bootstrap must not be cached as success for the life of the
 *  instance, or every later request reports a missing table instead. */
export function forgetSchema() {
  schemaReady = null;
}

export type EntryRow = {
  id: string;
  coffee: string;
  roaster: string;
  origins: string;
  altitude: string;
  tasting_notes: string;
  roast_level: string;
  roast_date: string;
  process: string;
  variety: string;
  comments: string;
  machine: string;
  grinder: string;
  basket: string;
  other: string;
  bag_grams: string;
  rest_from: string;
  rest_to: string;
  weighed_grams: string;
  weighed_at: Date | string | null;
  finished_at: Date | string | null;
  created_at: Date | string;
};

export type ShotRow = {
  id: string;
  entry_id: string;
  starred: boolean;
  grind: string;
  dose: string;
  yield_grams: string;
  time_min: string;
  time_sec: string;
  rpm: string;
  temp: string;
  infusion: string;
  pre_soak: boolean;
  extraction: number | null;
  notes: string;
  created_at: Date | string;
};

export function rowToShot(row: ShotRow): Shot {
  return {
    id: row.id,
    starred: row.starred,
    grind: row.grind,
    dose: row.dose,
    yield: row.yield_grams,
    timeMin: row.time_min,
    timeSec: row.time_sec,
    rpm: row.rpm,
    temp: row.temp,
    infusion: row.infusion,
    ps: row.pre_soak,
    extraction: row.extraction,
    notes: row.notes,
    pulledAt: new Date(row.created_at).getTime(),
  };
}

function rowToEntry(row: EntryRow, shots: Shot[]): Entry {
  return {
    id: row.id,
    createdAt: new Date(row.created_at).getTime(),
    coffee: row.coffee,
    roaster: row.roaster,
    origins: row.origins,
    altitude: row.altitude,
    tastingNotes: row.tasting_notes,
    roastLevel: row.roast_level,
    roastDate: row.roast_date,
    process: row.process,
    variety: row.variety,
    comments: row.comments,
    machine: row.machine,
    grinder: row.grinder,
    basket: row.basket,
    other: row.other,
    bagGrams: row.bag_grams,
    restFrom: row.rest_from,
    restTo: row.rest_to,
    weighedGrams: row.weighed_grams,
    weighedAt: row.weighed_at === null ? null : new Date(row.weighed_at).getTime(),
    finishedAt: row.finished_at === null ? null : new Date(row.finished_at).getTime(),
    shots,
  };
}

/** A moment in ms as a SQL timestamp, or null. */
const at = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/** Opens the connection and makes sure the tables exist, or hands back the
 *  response explaining why it couldn't. Shared with /api/shots. */
export async function connect(): Promise<
  { sql: Sql } | { failure: { status: number; body: unknown } }
> {
  if (!connectionString) {
    // Listing the names (never the values) turns "it doesn't work" into an
    // answer: either the integration isn't connected, or it named the variable
    // something this doesn't recognise.
    const candidates = Object.keys(process.env)
      .filter((name) => /url|postgres|database|neon/i.test(name))
      .sort();
    return {
      failure: {
        status: 503,
        body: {
          error: "No database is connected to this deployment.",
          needsSetup: true,
          lookedFor: CONNECTION_VARS,
          environmentVariablesPresent: candidates,
        },
      },
    };
  }

  const sql = neon(connectionString);
  try {
    await ensureSchema(sql);
  } catch (error) {
    forgetSchema();
    return {
      failure: {
        status: 500,
        body: { error: `Couldn't reach the database: ${message(error)}` },
      },
    };
  }
  return { sql };
}

export const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const one = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

/* ------------------------------------------------------------------ auth */

/** Which tokens are accepted, and how a chosen one is tidied, lives in
 *  src/lib/tokens.ts so the app checks a typed token by the same rules. */

/** A fast hash, not a password hash, and the lookup is an indexed equality
 *  rather than a scan.
 *
 *  For an issued token that is plainly right: 256 random bits leave nothing to
 *  brute-force. A chosen token is weaker by design — it is only as strong as
 *  it is hard to guess, and a copy of this table would let someone test
 *  guesses offline quickly. That is the trade for a token you can remember;
 *  the profile page says as much and asks for at least six characters. */
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export function newToken(): string {
  return `cl_${randomBytes(32).toString("base64url")}`;
}

/** The token part of `Authorization: Bearer …`, untidied. A chosen token can
 *  contain spaces ("blue moon"), so everything after the scheme counts. */
export function bearerToken(req: Req): string {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^Bearer\s+(.+)$/i.exec(value ?? "");
  return match ? match[1].trim() : "";
}

export const UNAUTHORIZED = {
  error: "A valid token is needed to open this ledger.",
  unauthorized: true,
};

/** The id of the user this request's token belongs to, or null. */
export async function authenticate(sql: Sql, req: Req): Promise<string | null> {
  // Tidied the way it was when it was chosen, so "Blue Moon" finds "blue moon".
  // Anything that can't be a token of either kind never reaches the database.
  const token = normalizeToken(bearerToken(req));
  if (!token) return null;
  const rows = (await sql`
    select id from users where token_hash = ${hashToken(token)}
  `) as { id: string }[];
  return rows[0]?.id ?? null;
}

/** Make a user and return the only copy of their token that will ever exist. */
export async function createUser(sql: Sql): Promise<string> {
  const token = newToken();
  const id = randomBytes(12).toString("hex");
  await sql`
    insert into users (id, token_hash) values (${id}, ${hashToken(token)})
  `;
  return token;
}

export default async function handler(req: Req, res: Res) {
  res.setHeader("Cache-Control", "no-store");

  const opened = await connect();
  if ("failure" in opened) {
    res.status(opened.failure.status).json(opened.failure.body);
    return;
  }
  const { sql } = opened;
  const method = req.method ?? "GET";

  // Before anything else, including the 405: nobody learns what the route
  // accepts without a token.
  let userId: string | null;
  try {
    userId = await authenticate(sql, req);
  } catch (error) {
    res.status(500).json({ error: `Database error: ${message(error)}` });
    return;
  }
  if (!userId) {
    res.status(401).json(UNAUTHORIZED);
    return;
  }

  try {
    if (method === "GET" || method === "HEAD") {
      // Two queries rather than a join: a join repeats every coffee's fourteen
      // text columns once per shot, and the grouping has to happen in JS
      // either way.
      const [entryRows, shotRows] = (await Promise.all([
        sql`select * from entries where user_id = ${userId} order by created_at desc`,
        sql`
          select s.* from shots s
          join entries e on e.id = s.entry_id
          where e.user_id = ${userId}
          order by s.created_at asc, s.id asc
        `,
      ])) as [EntryRow[], ShotRow[]];

      const byEntry = new Map<string, Shot[]>();
      for (const row of shotRows) {
        const list = byEntry.get(row.entry_id);
        if (list) list.push(rowToShot(row));
        else byEntry.set(row.entry_id, [rowToShot(row)]);
      }

      res.status(200).json({
        entries: entryRows.map((row) => rowToEntry(row, byEntry.get(row.id) ?? [])),
      });
      return;
    }

    if (method === "POST") {
      if (JSON.stringify(req.body ?? null).length > MAX_ENTRY_BYTES) {
        res.status(413).json({ error: "That coffee is implausibly large." });
        return;
      }
      // toEntry fills in whatever the request left out, so a client that only
      // knows about some of the fields can't blank the rest by omission — it
      // has to send them. It returns null only when the id is missing or
      // malformed, which is the one thing that can't be defaulted.
      const entry = toEntry(req.body ?? null);
      if (!entry) {
        res.status(400).json({
          error: "A coffee needs an id of letters, numbers, dashes or underscores.",
        });
        return;
      }

      // Saving the same id again replaces it, which is what editing a coffee
      // should do. created_at is left alone on update so a coffee doesn't jump
      // to the top of the ledger when a typo in it is fixed. Shots are keyed
      // separately and are not touched here.
      const rows = (await sql`
        insert into entries (
          id, coffee, roaster, origins, altitude, tasting_notes,
          roast_level, roast_date, process, variety, comments,
          machine, grinder, basket, other, created_at, user_id,
          bag_grams, rest_from, rest_to, weighed_grams, weighed_at, finished_at
        ) values (
          ${entry.id}, ${entry.coffee}, ${entry.roaster}, ${entry.origins},
          ${entry.altitude}, ${entry.tastingNotes}, ${entry.roastLevel},
          ${entry.roastDate}, ${entry.process}, ${entry.variety},
          ${entry.comments}, ${entry.machine}, ${entry.grinder},
          ${entry.basket}, ${entry.other}, to_timestamp(${entry.createdAt} / 1000.0),
          ${userId},
          ${entry.bagGrams}, ${entry.restFrom}, ${entry.restTo}, ${entry.weighedGrams},
          ${at(entry.weighedAt)}::timestamptz, ${at(entry.finishedAt)}::timestamptz
        )
        on conflict (id) do update set
          coffee        = excluded.coffee,
          roaster       = excluded.roaster,
          origins       = excluded.origins,
          altitude      = excluded.altitude,
          tasting_notes = excluded.tasting_notes,
          roast_level   = excluded.roast_level,
          roast_date    = excluded.roast_date,
          process       = excluded.process,
          variety       = excluded.variety,
          comments      = excluded.comments,
          machine       = excluded.machine,
          grinder       = excluded.grinder,
          basket        = excluded.basket,
          other         = excluded.other,
          bag_grams     = excluded.bag_grams,
          rest_from     = excluded.rest_from,
          rest_to       = excluded.rest_to,
          weighed_grams = excluded.weighed_grams,
          weighed_at    = excluded.weighed_at,
          finished_at   = excluded.finished_at,
          updated_at    = now()
        where entries.user_id = excluded.user_id
        returning *
      `) as EntryRow[];

      // The id exists and it is someone else's. Ids are random, so this is a
      // collision or a probe; either way the answer is no, and nothing of
      // theirs was touched.
      if (rows.length === 0) {
        res.status(409).json({ error: "That id is already taken." });
        return;
      }

      res.status(200).json({ entry: rowToEntry(rows[0], entry.shots), saved: entry.id });
      return;
    }

    if (method === "DELETE") {
      const id = one(req.query.id);
      if (!id) {
        res.status(400).json({ error: "No id given." });
        return;
      }

      const rows = (await sql`
        delete from entries where id = ${id} and user_id = ${userId} returning id
      `) as { id: string }[];
      if (rows.length === 0) {
        res.status(404).json({ error: `No coffee in the ledger with the id "${id}".` });
        return;
      }

      res.status(200).json({ deleted: id });
      return;
    }

    res.status(405).json({ error: "Use GET, POST or DELETE." });
  } catch (error) {
    res.status(500).json({ error: `Database error: ${message(error)}` });
  }
}
