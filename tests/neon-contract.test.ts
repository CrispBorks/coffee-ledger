/** Holds the stub the other tests run on against the real driver.
 *
 *  This file deliberately does not mock @neondatabase/serverless — that is the
 *  whole point of it. api/ is verified against a local Postgres through a
 *  stand-in transport, and that verification is only worth anything while the
 *  stand-in sends what the real client sends. */

import { describe, expect, it } from "vitest";
import * as driver from "@neondatabase/serverless";
import { neon, neonConfig } from "@neondatabase/serverless";

import { devApi } from "../dev/api-plugin";
import { toQuery } from "./neon-stub";

describe("the driver under test is the real one", () => {
  it("has not been aliased to something local", () => {
    // dev/api-plugin.ts aliases this package to a PGlite shim when there is no
    // DATABASE_URL, and Vitest reads the same vite.config.ts. If that alias
    // ever reaches the test run, every check below is measuring the shim
    // against itself. Pool and Client exist only on the real package.
    expect(typeof driver.Pool).toBe("function");
    expect(typeof driver.Client).toBe("function");
  });

  it("is kept out of the test run by the plugin itself", () => {
    const plugin = devApi();
    const apply = plugin.apply as (c: unknown, e: { command: string }) => boolean;
    expect(apply({}, { command: "serve" })).toBe(false); // VITEST is set here
    expect(apply({}, { command: "build" })).toBe(false);
  });
});

describe("the stub is the driver", () => {
  it("sends exactly what @neondatabase/serverless would send", async () => {
    let captured: { query: string; params: unknown[] } | undefined;
    (neonConfig as Record<string, unknown>).fetchFunction = async (
      _url: unknown,
      opts: { body: string },
    ) => {
      captured = JSON.parse(opts.body);
      return new Response(
        JSON.stringify({ command: "SELECT", rowCount: 0, rows: [], fields: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const sql = neon("postgresql://u:p@ep-x.us-east-2.aws.neon.tech/db");
    const id = "'); drop table entries; --";

    // The same template through both, so the comparison is of the conversion
    // rather than of two hand-written strings.
    const build = (tag: (s: TemplateStringsArray, ...v: any[]) => any) => tag`
      insert into shots (id, notes, starred, extraction)
      values (${id}, ${"Café ☕️"}, ${true}, ${62})
      returning *
    `;

    await build(sql);
    const mine = build((strings, ...values) => toQuery(strings, values));

    expect(captured?.query).toBe(mine.query);
    expect(captured?.params).toEqual(mine.params);
    // Named explicitly: every parameter crosses as text, whatever it started as.
    expect(mine.params).toEqual([id, "Café ☕️", "true", "62"]);
  });
});
