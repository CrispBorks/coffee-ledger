# Coffee Ledger

A minimal espresso ledger — one entry per coffee, with roast info up top and a
running shot log below. Star a shot to mark it your best pull for that bag.

Built with the same stack and "card stock" theme as Card Catalog: React 19 +
Vite + Tailwind v4 + shadcn/ui (Radix) + react-router.

## Data

Entries live in Postgres, behind two serverless functions in `api/`. The ledger
follows you between the phone and the laptop, and clearing site data no longer
clears it.

Each ledger belongs to a **token**. The first time you open the site it asks for
one: enter a token you already have, or start a new ledger and the app generates
one and shows it to you once. Generated tokens are long and random, so the
**profile page lets you swap yours for one you'll remember** — "blue moon
espresso" — and that's what you type on every other device. Past that screen,
open it, add a coffee, it's saved.

Each token also has a **profile**: a name, and your gear — machine, grinder,
basket, other. Gear is set once there instead of on every coffee; each coffee
you add is recorded with the gear you had at the time, so a new grinder later
doesn't change what older grind settings meant.

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

### Bags

Each coffee is one bag. Add Coffee asks for its size, and its **rest window**,
the stretch of days off roast when it's good for espresso. By default the
window comes from the roast level (light: day 14–42, medium: 7–30, dark:
4–21); any bag can set its own days. These are rules of thumb, not facts. The
coffee and its card in the ledger say *Resting · ready Oct 24*, *In its window ·
until Nov 21*, or *Past its best*.

**Grams left** is the bag size minus every dose logged on it, with shots left
worked out from your recent doses. Shots that aren't logged (purges, a
pour-over, a guest) make it drift, so **Weigh it** lets you put the beans on a
scale and count down from that instead.

When the count says the bag is empty, the app **asks** whether to finish it;
it never finishes one on its own. A finished bag keeps everything (its shots
and its starred recipe), stops taking new shots, and moves to a folded
**Finished** section at the bottom of the ledger. **Reopen** undoes it.

### On the home screen

Add it to the home screen (Safari → Share → Add to Home Screen) and it opens
full screen, as **Coffee**, with its own icon.

- `public/sw.js` keeps the app itself on the phone, so it opens with no
  connection at all. It never caches `/api`.
- The app keeps its own copy of your ledger on the device and opens on it
  straight away, then asks the server for anything newer. With no connection
  it says *Offline · showing what's saved on this device*, and anything you log
  is kept and sent when the connection is back, even if the app is closed in
  between.
- **Lock this device** deletes that copy, and anything unsent, along with the
  token.

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

Two shot columns carry meaning beyond their type. `extraction` is the taste, 0
(sour) to 100 (bitter) in five steps of 20 — and `null` means *not tasted yet*.
Shots logged before that existed default to 50, so an old "balanced" may just be
a shot nobody rated. `created_at` is when the shot was pulled, as the device
that logged it saw it, and it orders the log; it never changes on an edit, which
is also how an undone delete goes back in its place.

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

### Tokens

A token is the whole account model: no email, no password. There are two kinds,
and the rules for both live in `src/lib/tokens.ts`, shared by the app and the
server so they can't disagree:

- **Issued** — `cl_` followed by 43 random characters (256 bits), from "Start a
  new ledger". Matched exactly.
- **Chosen** — what you swap it for on the profile page: 6–64 characters of
  letters, numbers, spaces, dashes, dots and underscores. Not case-sensitive,
  and spaces are tidied, so a phone capitalising the first letter doesn't
  matter. ASCII only, because a token travels in an HTTP header.

A chosen token is exactly as private as it is hard to guess — anyone who types
it opens that ledger. It's stored as a SHA-256 like an issued one, but that's a
fast hash, so a stolen copy of the database could be tested against guesses
quickly. That's the trade for not writing it down.

- **Making one.** `POST /api/session` creates a user and returns the token. That
  response is the only time it exists in readable form — the database stores its
  SHA-256, so a copy of the database is not a set of working keys, and there is
  nothing to look up or reset if one is lost. The app says so and makes you tick
  "I've saved it" before it will open the ledger.
- **Using one.** Every request carries `Authorization: Bearer <token>`. The
  browser keeps it in `localStorage` (`coffeeLedger.token`), so you stay in on
  that device and have to paste it once on each new one.
- **Isolation.** Every query is scoped to the user the token resolves to. Another
  user's coffees and shots are not returned, cannot be deleted, and cannot be
  overwritten by reusing an id.
- **Changing one.** `PUT /api/session` with `{ token }` swaps it for a chosen
  one. It needs the current token, so only whoever is already in a ledger can
  do it. The old token stops working immediately; the device that changed it
  switches over without signing in again, and every other device needs the new
  one. A token someone else already has is refused.
- **Locking a device.** The lock button in the header makes the browser forget
  its token. It doesn't revoke it; it still works anywhere it's been kept.

What this does *not* do: there is no recovery, no revocation and no rate limit,
and `POST /api/session` is open — anyone who can reach the site can make an
(empty) ledger. If that matters, put Vercel's Deployment Protection in front of
the site or add a signup limit.

#### Upgrading a database from before tokens

The schema upgrades itself: `users` is created, and `entries` gets a nullable
`user_id`. Coffees saved before tokens existed have no owner, so no token can
see them — they are still in the table. To hand them to a ledger, make a token
in the app, then in the Neon console:

```sql
update entries set user_id = (select id from users order by created_at desc limit 1)
where user_id is null;
```

### The routes

Everything except `POST /api/session` needs `Authorization: Bearer <token>` and answers
`401` without one.

| | |
| --- | --- |
| `POST /api/session` | make a new ledger, return its token (once) |
| `GET /api/session` | 200 if the token in the header is valid, else 401 |
| `PUT /api/session` | change your token to one you chose: `{ token }` |
| `GET /api/profile` | your name and gear |
| `POST /api/profile` | replace them; fields left out are stored blank |
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

Four suites, covering the parts that could quietly lose someone's shot log:

- **The write queue** in `src/lib/ledger.ts` — ordering, coalescing, flush on
  close, and what happens to a write the server refuses. Driven against a
  stubbed `fetch`.
- **The token** in `tests/auth.test.ts` — what the client sends, and what it
  does when the server says no or the device is locked.
- **The shapes crossing the wire** in `src/lib/ledger-types.ts`, which is what
  stops a partial write blanking a column it didn't mention.
- **The routes**, against a real Postgres, including that every route refuses a
  missing or wrong token and that one user can't read, overwrite or delete
  another's coffees and shots. `tests/api.test.ts` runs the
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
