# Coffee Ledger

A minimal espresso ledger — one entry per coffee, with roast info up top and a
running shot log below. Star a shot to mark it your best pull for that bag.

Built with the same stack and "card stock" theme as Card Catalog: React 19 +
Vite + Tailwind v4 + shadcn/ui (Radix) + react-router.

## Data

Entries are saved to `localStorage` in the browser (no backend). That's a
good fit for a static Vercel deploy: it works immediately with zero setup,
but the ledger is per-browser/device — it won't sync between your phone and
laptop, and clearing site data clears it. If you outgrow that, swapping
`src/lib/ledger.ts` for a small API backed by Vercel Postgres/KV is the
natural next step; the rest of the app only talks to that one file.

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Outputs to `dist/`. `vercel.json` is already set up to rewrite all routes to
`index.html` for client-side routing.
