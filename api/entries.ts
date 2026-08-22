/** /api/entries — the ledger itself, in Postgres.
 *
 *  GET    → { entries }   every coffee, newest first, each with its shot log
 *  POST   → { entry }     add or replace one coffee, by id (shots untouched)
 *  DELETE → ?id=…         remove a coffee and every shot logged against it
 *
 *  Shots are written one at a time through /api/shots, which imports the
 *  connection and the auth gate from here. Two routes rather than one whole-
 *  ledger document because the shot log is the point of the thing: editing a
 *  dose should write that dose, not re-post every bag you own — and rows mean
 *  a later "every starred shot on the Niche" is a query, not a scan in JS.
 *
 *  Writes need the key in LEDGER_WRITE_KEY; without it this would be a public
 *  write endpoint on a public URL. Reads are open, like the rest of the site. */

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
import { checkWriteAccess } from "./session.js";

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
const CONNECTION_VARS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "STORAGE_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
];

const isPostgresUrl = (value: string | undefined) =>
  typeof value === "string" && /^postgres(ql)?:\/\//i.test(value);

function findConnectionString(): string {
  for (const name of CONNECTION_VARS) {
    if (isPostgresUrl(process.env[name])) return process.env[name] as string;
  }
  // A custom prefix produces something like MYPREFIX_URL, so fall back to any
  // variable at all whose value is a Postgres URL.
  for (const [name, value] of Object.entries(process.env)) {
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
  extraction: number;
  notes: string;
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
    shots,
  };
}

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

export default async function handler(req: Req, res: Res) {
  res.setHeader("Cache-Control", "no-store");

  const opened = await connect();
  if ("failure" in opened) {
    res.status(opened.failure.status).json(opened.failure.body);
    return;
  }
  const { sql } = opened;
  const method = req.method ?? "GET";

  try {
    if (method === "GET" || method === "HEAD") {
      // Two queries rather than a join: a join repeats every coffee's fourteen
      // text columns once per shot, and the grouping has to happen in JS
      // either way.
      const [entryRows, shotRows] = (await Promise.all([
        sql`select * from entries order by created_at desc`,
        sql`select * from shots order by created_at asc, id asc`,
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

    const denied = checkWriteAccess(req);
    if (denied) {
      res.status(denied.status).json(denied.body);
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
          machine, grinder, basket, other, created_at
        ) values (
          ${entry.id}, ${entry.coffee}, ${entry.roaster}, ${entry.origins},
          ${entry.altitude}, ${entry.tastingNotes}, ${entry.roastLevel},
          ${entry.roastDate}, ${entry.process}, ${entry.variety},
          ${entry.comments}, ${entry.machine}, ${entry.grinder},
          ${entry.basket}, ${entry.other}, to_timestamp(${entry.createdAt} / 1000.0)
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
          updated_at    = now()
        returning *
      `) as EntryRow[];

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
        delete from entries where id = ${id} returning id
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
