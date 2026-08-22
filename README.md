# Coffee Ledger

A minimal espresso ledger — one entry per coffee, with roast info up top and a
running shot log below. Star a shot to mark it your best pull for that bag.

Built with the same stack and "card stock" theme as Card Catalog: React 19 +
Vite + Tailwind v4 + shadcn/ui (Radix) + react-router.

## Data

Entries live in Postgres, behind two serverless functions in `api/`. The ledger
follows you between the phone and the laptop, and clearing site data no longer
clears it.

There is nothing to sign in to and nothing to type once. Open it, add a coffee,
it's saved.

There is no Save button, and there wasn't one before either — the shot log is
edited in place, a cell at a time, and that hasn't changed. What happens under
it has:

- **Local first.** An edit lands in memory and paints immediately. The write is
  a consequence of the edit, never a gate in front of it.
- **Coalesced.** Writes for the same row are held for 600ms and collapsed, so
  typing a tasting note is one request, not forty.
- **Serial and ordered.** One request at a time, FIFO — which is what
  guarantees a brand-new coffee is inserted before the first shot logged
  against it.

Nothing is dropped: a write that fails is held, counted, and shown in the
bottom corner with a **Retry**. That corner is silent when everything has
landed, which is nearly always.

`src/lib/ledger.ts` is still the only file the rest of the app talks to, and
still exports `useEntries()`, `addShot()`, `updateEntry()` and the rest. The
pages didn't have to learn about any of the above.

### Schema

Two tables, created on first use — there's no migration step to run.

```sql
entries(id text primary key, coffee text, roaster text, origins text,
        altitude text, tasting_notes text, roast_level text, roast_date text,
        process text, variety text, comments text, machine text, grinder text,
        basket text, other text, created_at timestamptz, updated_at timestamptz)

shots(id text primary key, entry_id text references entries(id) on delete cascade,
      starred boolean, grind text, dose text, yield_grams text, time_min text,
      time_sec text, rpm text, temp text, infusion text, pre_soak boolean,
      extraction integer, notes text, created_at timestamptz, updated_at timestamptz)
```

Shots are rows rather than a blob on the entry because the shot log is the
point of the thing: editing a dose writes that dose, and a later "every starred
shot pulled on the Niche" is a query rather than a scan in JavaScript.

The measurements are `text`, not `numeric`, on purpose. A blank dose means "not
weighed" and `~18.2` means what it says; a number column turns the first into a
zero and refuses the second. Averaging them is a job for a view over the table,
when there's something worth averaging.

## Deploying

A static single-page build on Vercel, plus `api/`. `vercel.json` rewrites every
path except `/api/*` to `index.html`, so deep links like `/entry/abc123`
resolve on a hard refresh — any host needs that same SPA fallback.

One thing to set up, on the free tier:

**A Postgres database.** Vercel dashboard → Storage → Neon (Vercel Postgres is
Neon now; `@vercel/postgres` is deprecated). Connect it to the project and it
sets `DATABASE_URL` for you. The tables are created on first use — no migration
step, no seed, and no second environment variable.

Skip it and the ledger still loads; it just says plainly that saving isn't set
up rather than pretending an edit was stored.

### Who can write to it

Nobody has to type anything, which is the point — and it means the routes are
open to whoever can reach the URL. Reads were always public; now writes are too.

Keeping the ledger private is a deployment setting rather than something the app
asks you for. Vercel's **Deployment Protection** (Project → Settings →
Deployment Protection) puts either a password or your Vercel login in front of
the whole site, functions included. It's one switch, it's free on a personal
project, and unlike a key in the app there's nothing to re-enter on a new
phone.

### The routes

| | |
| --- | --- |
| `GET /api/entries` | every coffee, newest first, each with its shot log |
| `POST /api/entries` | add or replace one coffee, by id |
| `DELETE /api/entries?id=` | remove a coffee and every shot logged against it |
| `POST /api/shots` | add or replace one shot, by id |
| `DELETE /api/shots?id=` | remove one shot |

### Coming from the localStorage version

Coffees saved in a browser before the database are offered as a one-time import
at the top of the ledger. Importing copies them up; the browser's copy is moved
aside rather than deleted, either way.

## Develop

```bash
npm install
npm run dev
```

That's the whole setup. The dev server runs the functions in `api/` as well as
the app, so the ledger works immediately — no `vercel dev`, no account, no
database to provision. With no `DATABASE_URL` set it keeps a local Postgres in
`.pglite/` ([PGlite](https://pglite.dev), Postgres 18 compiled to wasm, so it's
the real thing rather than a mock). Set `DATABASE_URL` and it uses that
instead, which is how you point local development at a real branch.

The plugin doing this is `dev/api-plugin.ts`. It's `apply: "serve"`, so none of
it reaches the build — production is still Vercel's functions and Neon — and it
loads the same handler files rather than a copy of them.

## Tests

```bash
npm test        # ~4s, no browser and no deployment needed
```

Three suites, covering the parts that could quietly lose someone's shot log:

- **The write queue** in `src/lib/ledger.ts` — ordering, coalescing, flush on
  close, and what happens to a write the server refuses. Driven against a
  stubbed `fetch`.
- **The shapes crossing the wire** in `src/lib/ledger-types.ts`, which is what
  stops a partial write blanking a column it didn't mention.
- **The routes**, against a real Postgres. `tests/api.test.ts` runs the
  handlers in `api/` over [PGlite](https://pglite.dev) — Postgres 18 compiled
  to wasm — so the SQL is executed rather than described: the tables really are
  created, an upsert really does update instead of duplicating, `created_at`
  really does survive an edit, and deleting a coffee really does take its shots
  with it.

Only the Neon HTTP transport is stubbed there, and the last test in that file
holds the stub against the real `@neondatabase/serverless` client to check they
put the same SQL and the same parameters on the wire — including that Neon
sends every parameter as text, which is what `to_timestamp($n / 1000.0)` and
the boolean columns depend on.

## Build

```bash
npm run build
```

Typechecks the app and the functions, then outputs to `dist/`.
