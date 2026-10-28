/** /api/session — where a ledger's token comes from.
 *
 *  POST → { token }   make a new, empty ledger and return its token
 *  GET  → { ok }      check the token in the Authorization header
 *
 *  The token is returned once, here, and never again: only its hash is stored,
 *  so there is nothing to look up if it is lost. That is the whole account
 *  model — no email, no password, no recovery — and the app says so before it
 *  lets anyone past the screen that shows it. */

import {
  UNAUTHORIZED,
  authenticate,
  connect,
  createUser,
  message,
  type Req,
  type Res,
} from "./entries.js";

export default async function handler(req: Req, res: Res) {
  res.setHeader("Cache-Control", "no-store");

  const method = req.method ?? "GET";
  if (method !== "POST" && method !== "GET") {
    res.status(405).json({ error: "Use POST or GET." });
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

    if (!(await authenticate(sql, req))) {
      res.status(401).json(UNAUTHORIZED);
      return;
    }
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: `Database error: ${message(error)}` });
  }
}
