# Coffee Ledger

A minimal espresso ledger — one entry per coffee, with roast info up top and a
running shot log below. Star a shot to mark it your best pull for that bag.

Built with the same stack and "card stock" theme as Card Catalog: React 19 +
Vite + Tailwind v4 + shadcn/ui (Radix) + react-router.

## Data

Entries live in Postgres, behind three serverless functions in `api/`. The
ledger follows you between the phone and the laptop, and clearing site data no
longer clears it.

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

Two things to set up once, both on free tiers:

1. **A Postgres database.** Vercel dashboard → Storage → Neon (Vercel Postgres
   is Neon now; `@vercel/postgres` is deprecated). Connect it to the project
   and it sets `DATABASE_URL` for you. The tables are created on first use.

2. **`LEDGER_WRITE_KEY`** as an environment variable — any passphrase. Reads
   are public like the rest of the site, but without this anyone who found the
   URL could write to your ledger, so changes refuse to save until it's set.

   The app asks for the key the first time a device tries to change something,
   trades it at `POST /api/session` for a year-long `HttpOnly` cookie, and
   doesn't ask again. A cookie rather than `localStorage` because Safari caps
   anything JavaScript writes at seven days — on iOS that's the difference
   between typing the key once and typing it every week. The write routes also
   accept an `x-ledger-key` header, so the API stays usable from curl.

Skip either and the ledger still loads and reads; it just says plainly that
saving isn't set up rather than pretending an edit was stored.

### The routes

| | |
| --- | --- |
| `GET /api/entries` | every coffee, newest first, each with its shot log |
| `POST /api/entries` | add or replace one coffee, by id |
| `DELETE /api/entries?id=` | remove a coffee and every shot logged against it |
| `POST /api/shots` | add or replace one shot, by id |
| `DELETE /api/shots?id=` | remove one shot |
| `POST /api/session` | trade the key for a cookie · `DELETE` signs out |

### Coming from the localStorage version

Coffees saved in a browser before the database are offered as a one-time import
at the top of the ledger. Importing copies them up; the browser's copy is moved
aside rather than deleted, either way.

## Develop

```bash
npm install
npm run dev
```

`npm run dev` serves the app only — Vite doesn't run the functions in `api/`,
so the ledger will report that the routes aren't running. Use `vercel dev`, or
a preview deployment, to exercise them.

## Tests

```bash
npm test        # ~3s, no browser and no database needed
```

They cover the two things that could quietly lose someone's shot log: the write
queue in `src/lib/ledger.ts` — ordering, coalescing, what happens to a refused
write — and the auth gate in `api/session.ts`. Both run against a stubbed
`fetch` rather than a deployment.

## Build

```bash
npm run build
```

Typechecks the app and the functions, then outputs to `dist/`.
