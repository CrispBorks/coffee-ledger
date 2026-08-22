/** POST /api/session — trades the ledger key for a cookie, so it's typed once
 *  per device and then forgotten about. DELETE /api/session signs out.
 *
 *  A cookie rather than localStorage for two reasons. It's set by the server as
 *  HttpOnly, which means Safari's tracking prevention doesn't cap it at seven
 *  days the way it does anything JavaScript writes — on iOS that's the
 *  difference between typing the key once and typing it every week. And the
 *  browser attaches it automatically, so nothing in the app has to remember a
 *  secret or hang it off each request.
 *
 *  The cookie holds a hash of the key, not the key: it is never readable by
 *  script, but there's no reason for the raw value to sit in a cookie jar. */

import { createHash, timingSafeEqual } from "node:crypto";

type Req = {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
};
type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

export const COOKIE_NAME = "ledger_session";
export const KEY_HEADER = "x-ledger-key";
export const KEY_VAR = "LEDGER_WRITE_KEY";
const A_YEAR = 60 * 60 * 24 * 365;

export const tokenFor = (key: string) =>
  createHash("sha256").update(key).digest("hex");

/** Compared in constant time. The window is tiny for a personal coffee log,
 *  but a comparison that returns early on the first wrong character is a bad
 *  habit to leave in an auth path. */
export function tokenMatches(token: string, key: string): boolean {
  const expected = Buffer.from(tokenFor(key));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function readCookie(
  header: string | string[] | undefined,
  name: string,
): string {
  const raw = Array.isArray(header) ? header.join("; ") : (header ?? "");
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

/** The one gate in front of every write route. Returns null when the request
 *  may proceed, or the response to send back when it may not. */
export function checkWriteAccess(
  req: Pick<Req, "headers">,
): { status: number; body: unknown } | null {
  const expected = process.env[KEY_VAR];
  if (!expected) {
    return {
      status: 503,
      body: { error: `Saving isn't set up on this deployment — ${KEY_VAR} isn't set.`, needsSetup: true },
    };
  }

  // The cookie is the ordinary path — set once by /api/session and attached by
  // the browser thereafter. The header stays supported so the API is still
  // usable from a script or curl without a session.
  const header = req.headers[KEY_HEADER];
  const sent = Array.isArray(header) ? header[0] : header;
  const token = readCookie(req.headers.cookie, COOKIE_NAME);

  if (sent === expected) return null;
  if (token !== "" && tokenMatches(token, expected)) return null;
  return { status: 401, body: { error: "Wrong key.", needsKey: true } };
}

const cookie = (value: string, maxAge: number) =>
  [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "Secure",
    // Lax, not None: it stops another site's page from posting to this API with
    // the cookie riding along, which is the whole of the CSRF risk here.
    "SameSite=Lax",
  ].join("; ");

export default function handler(req: Req, res: Res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", cookie("", 0));
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }

  const expected = process.env[KEY_VAR];
  if (!expected) {
    res.status(503).json({
      error: `Saving isn't set up on this deployment — ${KEY_VAR} isn't set.`,
      needsSetup: true,
    });
    return;
  }

  const body = (req.body ?? {}) as { key?: unknown };
  const key = typeof body.key === "string" ? body.key : "";
  if (key === "" || key !== expected) {
    res.status(401).json({ error: "Wrong key.", needsKey: true });
    return;
  }

  res.setHeader("Set-Cookie", cookie(tokenFor(key), A_YEAR));
  res.status(200).json({ ok: true });
}
