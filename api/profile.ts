/** /api/profile — your name and your gear.
 *
 *  GET  → { profile }   { name, machine, grinder, basket, other }
 *  POST → { profile }   replace it; fields left out are stored blank
 *
 *  A profile is a user row: the token says whose it is, as on every route, so
 *  there is no id to send and no way to name someone else's. */

import {
  MAX_PROFILE_FIELD_LENGTH,
  PROFILE_FIELDS,
  toProfile,
  type Profile,
} from "../src/lib/ledger-types.js";
import { UNAUTHORIZED, authenticate, connect, message, type Req, type Res } from "./entries.js";

type ProfileRow = Profile;

export default async function handler(req: Req, res: Res) {
  res.setHeader("Cache-Control", "no-store");

  const opened = await connect();
  if ("failure" in opened) {
    res.status(opened.failure.status).json(opened.failure.body);
    return;
  }
  const { sql } = opened;

  try {
    // Before the 405, as everywhere else: nobody learns what the route takes
    // without a token.
    const userId = await authenticate(sql, req);
    if (!userId) {
      res.status(401).json(UNAUTHORIZED);
      return;
    }

    const method = req.method ?? "GET";

    if (method === "GET" || method === "HEAD") {
      const rows = (await sql`
        select name, machine, grinder, basket, other from users where id = ${userId}
      `) as ProfileRow[];
      res.status(200).json({ profile: toProfile(rows[0]) });
      return;
    }

    if (method === "POST") {
      const profile = toProfile(req.body ?? null);
      const tooLong = PROFILE_FIELDS.find((field) => profile[field].length > MAX_PROFILE_FIELD_LENGTH);
      if (tooLong) {
        res.status(413).json({
          error: `Keep the ${tooLong} under ${MAX_PROFILE_FIELD_LENGTH} characters.`,
        });
        return;
      }

      const rows = (await sql`
        update users set
          name    = ${profile.name},
          machine = ${profile.machine},
          grinder = ${profile.grinder},
          basket  = ${profile.basket},
          other   = ${profile.other}
        where id = ${userId}
        returning name, machine, grinder, basket, other
      `) as ProfileRow[];
      res.status(200).json({ profile: toProfile(rows[0]) });
      return;
    }

    res.status(405).json({ error: "Use GET or POST." });
  } catch (error) {
    res.status(500).json({ error: `Database error: ${message(error)}` });
  }
}
