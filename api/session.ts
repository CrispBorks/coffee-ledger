/** /api/session — where a ledger's token comes from, and how it's changed.
 *
 *  POST → { token }         make a new, empty ledger and return its token
 *  GET  → { ok }            check the token in the Authorization header
 *  PUT  → { ok, token }     swap your token for one you chose: { token }
 *
 *  An issued token is returned once, by POST, and never again: only its hash is
 *  stored, so there is nothing to look up if it is lost. That is the whole
 *  account model — no email, no password, no recovery.
 *
 *  PUT exists because an issued token is 46 characters nobody can remember,
 *  and two people sharing a ledger site shouldn't need a password manager for
 *  it. Changing it needs the current token, so only whoever is already in a
 *  ledger can rename the key to it. */

import { chosenToken, chosenTokenProblem } from "../src/lib/tokens.js";
import {
  UNAUTHORIZED,
  authenticate,
  connect,
  createUser,
  hashToken,
  message,
  type Req,
  type Res,
} from "./entries.js";

/** Postgres's unique_violation: another user's token already hashes to this. */
const isTaken = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";

export default async function handler(req: Req, res: Res) {
  res.setHeader("Cache-Control", "no-store");

  const method = req.method ?? "GET";
  if (method !== "POST" && method !== "GET" && method !== "PUT") {
    res.status(405).json({ error: "Use POST, GET or PUT." });
    return;
  }

  const opened = await connect();
  if ("failure" in opened) {
    res.status(opened.failure.status).json(opened.failure.body);
    return;
  }
  const { sql } = opened;

  try {
    if (method === "POST") {
      res.status(201).json({ token: await createUser(sql) });
      return;
    }

    const userId = await authenticate(sql, req);
    if (!userId) {
      res.status(401).json(UNAUTHORIZED);
      return;
    }

    if (method === "GET") {
      res.status(200).json({ ok: true });
      return;
    }

    // PUT: change this user's token to one they chose.
    const body = (req.body ?? {}) as { token?: unknown };
    const raw = typeof body.token === "string" ? body.token : "";
    const problem = chosenTokenProblem(raw);
    if (problem) {
      res.status(400).json({ error: problem });
      return;
    }
    const token = chosenToken(raw);

    try {
      await sql`update users set token_hash = ${hashToken(token)} where id = ${userId}`;
    } catch (error) {
      // Saying "taken" tells the asker that this string opens some ledger.
      // That gives away nothing the sign-in box doesn't: typing the same guess
      // there would simply open it. A chosen token is exactly as private as it
      // is hard to guess, and this answer doesn't change that.
      if (isTaken(error)) {
        res.status(409).json({ error: "That token is already someone's. Pick another." });
        return;
      }
      throw error;
    }

    // The tidied form, so the device stores exactly what the server matches.
    res.status(200).json({ ok: true, token });
  } catch (error) {
    res.status(500).json({ error: `Database error: ${message(error)}` });
  }
}
