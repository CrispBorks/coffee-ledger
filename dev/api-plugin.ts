/** Runs the functions in `api/` inside the Vite dev server.
 *
 *  Without this, `npm run dev` serves the app but not its API, so the ledger
 *  loads and then reports that it can't reach anything — you'd need `vercel
 *  dev` and a database before you could add a single coffee. This mounts the
 *  same handler files Vercel will run, at the same paths.
 *
 *  If DATABASE_URL is set it is used, so you can point local development at a
 *  real branch. If it isn't, the routes are backed by a local PGlite database
 *  in `.pglite/` and a fresh clone works with no setup at all.
 *
 *  Development only. `apply` keeps every line of it out of the production
 *  build, which still runs on Vercel's functions and Neon — and out of the
 *  test run, which matters more than it sounds: Vitest reads this same config,
 *  and the alias below would quietly swap the driver underneath the suite that
 *  exists to check the driver. */

import path from "node:path";
import type { Connect, Plugin } from "vite";

/** Only the routes that exist. Anything else under /api falls through to the
 *  SPA fallback, exactly as the rewrite in vercel.json leaves it. */
const ROUTES: Record<string, string> = {
  "/api/entries": "/api/entries.ts",
  "/api/shots": "/api/shots.ts",
  "/api/session": "/api/session.ts",
};

const CONNECTION_VARS = ["DATABASE_URL", "POSTGRES_URL", "DATABASE_URL_UNPOOLED"];

function readBody(req: Connect.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(undefined);
      }
    });
  });
}

export function devApi(): Plugin {
  return {
    name: "coffee-ledger:dev-api",

    // Not the "serve" shorthand: Vitest also runs with command "serve", and
    // this plugin must not be anywhere near it.
    apply: (_config, env) => env.command === "serve" && !process.env.VITEST,

    config() {
      if (CONNECTION_VARS.some((name) => process.env[name])) return;

      // The handlers look for a Postgres URL and refuse to run without one.
      // The value is never dialled — the aliased driver below ignores it — but
      // it has to be there and it has to look like one.
      process.env.DATABASE_URL = "postgresql://local/pglite";
      return {
        resolve: {
          // Vite is always run from the project root, so this is where the
          // shim is. An absolute path because aliases aren't resolved
          // relative to the importer.
          alias: {
            "@neondatabase/serverless": path.resolve(process.cwd(), "dev/pglite-neon.ts"),
          },
        },
      };
    },

    configureServer(server) {
      const local = !CONNECTION_VARS.some(
        (name) => process.env[name] && process.env[name] !== "postgresql://local/pglite",
      );
      server.config.logger.info(
        local
          ? "  \x1b[32m➜\x1b[0m  \x1b[1mledger\x1b[0m:   local Postgres in .pglite (set DATABASE_URL to use your own)"
          : "  \x1b[32m➜\x1b[0m  \x1b[1mledger\x1b[0m:   DATABASE_URL",
      );

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const file = ROUTES[url.pathname];
        if (!file) return next();

        // ssrLoadModule compiles the TypeScript and follows the same imports
        // Vercel's build will, so this is the deployed code path, not a copy.
        const send = {
          status(code: number) {
            res.statusCode = code;
            return send;
          },
          json(body: unknown) {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(body));
          },
          setHeader(name: string, value: string) {
            res.setHeader(name, value);
          },
        };

        try {
          const module = await server.ssrLoadModule(file);
          await module.default(
            {
              method: req.method,
              query: Object.fromEntries(url.searchParams),
              headers: req.headers,
              body: await readBody(req),
            },
            send,
          );
        } catch (error) {
          server.config.logger.error(`${url.pathname} failed: ${String(error)}`);
          if (!res.writableEnded) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: String(error) }));
          }
        }
      });
    },
  };
}
