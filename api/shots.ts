/** /api/shots — one row per pull, hung off a coffee in /api/entries.
 *
 *  POST   → { entryId, shot }   add or replace one shot, by id
 *  DELETE → ?id=…               remove one shot
 *
 *  Shots are read as part of GET /api/entries — there is no reason to fetch a
 *  shot log without the bag it belongs to — so this route only writes.
 *
 *  The whole shot log is edited in place, a field at a time, which is why a
 *  shot is addressable on its own: the client coalesces the keystrokes in one
 *  cell and writes that shot, rather than re-posting the coffee around it.
 *
 *  A shot belongs to a coffee and a coffee belongs to a user, so ownership is
 *  checked through the coffee: you can only log against your own, and only
 *  touch shots that hang off your own. */

import { ID_PATTERN, toShot } from "../src/lib/ledger-types.js";
import {
  UNAUTHORIZED,
  authenticate,
  connect,
  message,
  one,
  rowToShot,
  type Req,
  type Res,
  type ShotRow,
} from "./entries.js";

/** Postgres reports a missing parent row as foreign_key_violation (23503).
 *  It means the coffee was deleted between the page loading and this write,
 *  which is a "gone", not a "the server broke". */
const isMissingEntry = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === "23503";

export default async function handler(req: Req, res: Res) {
  res.setHeader("Cache-Control", "no-store");

  const method = req.method ?? "GET";
  if (method !== "POST" && method !== "DELETE") {
    res.status(405).json({ error: "Use POST or DELETE." });
    return;
  }

  const opened = await connect();
  if ("failure" in opened) {
    res.status(opened.failure.status).json(opened.failure.body);
    return;
  }
  const { sql } = opened;

  try {
    const userId = await authenticate(sql, req);
    if (!userId) {
      res.status(401).json(UNAUTHORIZED);
      return;
    }

    if (method === "POST") {
      const body = (req.body ?? {}) as { entryId?: unknown; shot?: unknown };
      const entryId = typeof body.entryId === "string" ? body.entryId : "";
      if (!ID_PATTERN.test(entryId)) {
        res.status(400).json({ error: "A shot needs the id of the coffee it belongs to." });
        return;
      }

      const shot = toShot(body.shot ?? null);
      if (!shot) {
        res.status(400).json({
          error: "A shot needs an id of letters, numbers, dashes or underscores.",
        });
        return;
      }

      // Someone else's coffee and a coffee that doesn't exist look the same
      // from here, and get the same answer — nothing says which it was.
      const owned = (await sql`
        select 1 as ok from entries where id = ${entryId} and user_id = ${userId}
      `) as unknown[];
      if (owned.length === 0) {
        res.status(409).json({
          error: "That coffee is no longer in the ledger, so the shot wasn't saved.",
        });
        return;
      }

      // created_at is left alone on update: it is what orders the shot log, so
      // correcting a dose must not move that shot to the bottom of the table.
      const rows = (await sql`
        insert into shots (
          id, entry_id, starred, grind, dose, yield_grams, time_min, time_sec,
          rpm, temp, infusion, pre_soak, extraction, notes
        ) values (
          ${shot.id}, ${entryId}, ${shot.starred}, ${shot.grind}, ${shot.dose},
          ${shot.yield}, ${shot.timeMin}, ${shot.timeSec}, ${shot.rpm},
          ${shot.temp}, ${shot.infusion}, ${shot.ps}, ${shot.extraction},
          ${shot.notes}
        )
        on conflict (id) do update set
          entry_id    = excluded.entry_id,
          starred     = excluded.starred,
          grind       = excluded.grind,
          dose        = excluded.dose,
          yield_grams = excluded.yield_grams,
          time_min    = excluded.time_min,
          time_sec    = excluded.time_sec,
          rpm         = excluded.rpm,
          temp        = excluded.temp,
          infusion    = excluded.infusion,
          pre_soak    = excluded.pre_soak,
          extraction  = excluded.extraction,
          notes       = excluded.notes,
          updated_at  = now()
        where exists (
          select 1 from entries e
          where e.id = shots.entry_id and e.user_id = ${userId}
        )
        returning *
      `) as ShotRow[];

      // The shot id is already in use under someone else's coffee. The
      // update's guard declined to overwrite it.
      if (rows.length === 0) {
        res.status(409).json({ error: "That id is already taken." });
        return;
      }

      res.status(200).json({ shot: rowToShot(rows[0]), entryId, saved: shot.id });
      return;
    }

    const id = one(req.query.id);
    if (!id) {
      res.status(400).json({ error: "No id given." });
      return;
    }

    const rows = (await sql`
      delete from shots s
      using entries e
      where s.id = ${id} and e.id = s.entry_id and e.user_id = ${userId}
      returning s.id
    `) as { id: string }[];
    if (rows.length === 0) {
      res.status(404).json({ error: `No shot in the ledger with the id "${id}".` });
      return;
    }

    res.status(200).json({ deleted: id });
  } catch (error) {
    if (isMissingEntry(error)) {
      res.status(409).json({
        error: "That coffee is no longer in the ledger, so the shot wasn't saved.",
      });
      return;
    }
    res.status(500).json({ error: `Database error: ${message(error)}` });
  }
}
