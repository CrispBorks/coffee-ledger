/** A stand-in for @neondatabase/serverless, used only by `npm run dev` when no
 *  DATABASE_URL is set.
 *
 *  PGlite is Postgres 18 compiled to wasm, so this is a real database with the
 *  real DDL and the real constraints — not a mock — kept in `.pglite/` next to
 *  the repo. It means a fresh clone runs the whole app, functions included,
 *  with nothing to sign up for.
 *
 *  The only thing being imitated is the transport. Neon's HTTP driver turns a
 *  tagged template into numbered placeholders and sends every parameter as
 *  text; so does this, because a parameter that only works while it is still a
 *  JavaScript number would work here and fail on the deployment. */

import { PGlite } from "@electric-sql/pglite";

let opening: Promise<PGlite> | null = null;
const open = () => (opening ??= PGlite.create({ dataDir: ".pglite" }));

export function neon() {
  return async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.reduce(
      (acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""),
      "",
    );
    const params = values.map((value) =>
      value === null || value === undefined
        ? null
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value),
    );
    return (await open()).query(query, params).then((result) => result.rows);
  };
}

export const neonConfig: Record<string, unknown> = {};
