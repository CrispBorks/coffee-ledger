/** What counts as a ledger token — shared by the app and the functions, so the
 *  screen that checks what you typed and the server that looks it up can never
 *  disagree. Nothing here may need the DOM or Node.
 *
 *  There are two kinds:
 *
 *  - **Issued** — what "Start a new ledger" hands out: `cl_` and 43 characters
 *    of base64url. Matched exactly; case matters, because in base64url it's
 *    part of the value.
 *  - **Chosen** — what someone picks on their profile page so they can stop
 *    carrying the issued one around: "blue moon", "yash-espresso". Not case-
 *    sensitive and forgiving about spaces, because it's typed from memory on a
 *    phone keyboard, which capitalises the first letter and likes to add a
 *    trailing space.
 */

/** 32 random bytes, base64url, behind a prefix that makes a token pasted into
 *  the wrong place recognisable as one. */
export const ISSUED_TOKEN = /^cl_[A-Za-z0-9_-]{43}$/;

export const MIN_CHOSEN_LENGTH = 6;
export const MAX_CHOSEN_LENGTH = 64;

/** ASCII only, deliberately: a token travels in an Authorization header, and
 *  browsers refuse to send a header containing anything outside Latin-1 — an
 *  emoji token would be accepted here and then fail on every request. */
const CHOSEN_CHARACTERS = /^[a-z0-9 ._-]+$/;

/** Lowercased, trimmed, and every run of whitespace made a single space — so
 *  "Blue  Moon " and "blue moon" are the same token. */
const tidy = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, " ");

/** Why this can't be someone's chosen token, or null if it can. */
export function chosenTokenProblem(raw: string): string | null {
  const token = tidy(raw);
  if (token.length < MIN_CHOSEN_LENGTH) {
    return `Use at least ${MIN_CHOSEN_LENGTH} characters.`;
  }
  if (token.length > MAX_CHOSEN_LENGTH) {
    return `Use at most ${MAX_CHOSEN_LENGTH} characters.`;
  }
  if (!CHOSEN_CHARACTERS.test(token)) {
    return "Use letters, numbers, spaces, dashes, dots or underscores.";
  }
  // Otherwise a chosen token could look exactly like an issued one, and the
  // two are matched by different rules.
  if (token.startsWith("cl_")) return "It can't start with cl_ — that's kept for generated tokens.";
  return null;
}

/** The chosen token as it will be stored and matched, or "" if it can't be one. */
export function chosenToken(raw: string): string {
  return chosenTokenProblem(raw) === null ? tidy(raw) : "";
}

/** Whatever was typed into the token box, as the server knows it — or "" if
 *  it can't be a token of either kind. Issued tokens come back exactly as
 *  typed (bar surrounding whitespace); chosen ones tidied. */
export function normalizeToken(raw: string): string {
  const typed = raw.trim();
  if (ISSUED_TOKEN.test(typed)) return typed;
  return chosenToken(typed);
}
