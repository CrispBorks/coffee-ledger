/** Where this device keeps its token.
 *
 *  A token is the only thing that says whose ledger this is, so it lives in
 *  localStorage under one key and nowhere else: not in a URL, not in a cookie
 *  the server could be tricked into reading, not in the app's state. Anything
 *  that talks to /api asks for it here. */

const TOKEN_KEY = "coffeeLedger.token";

export function getToken(): string {
  if (typeof localStorage === "undefined") return "";
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return ""; // private mode, storage blocked
  }
}

/** Returns false when the browser wouldn't keep it — the caller has to say so,
 *  because a token that survives only until the tab closes is a ledger that
 *  quietly locks itself. */
export function setToken(token: string): boolean {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    return localStorage.getItem(TOKEN_KEY) === token;
  } catch {
    return false;
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing to do */
  }
}

/** The shape of a token, checked before it is sent anywhere. Mirrors the server
 *  so a typo is caught on the device rather than as a round trip. */
export const looksLikeToken = (value: string) => /^cl_[A-Za-z0-9_-]{43}$/.test(value);

export const authHeader = (): Record<string, string> => {
  const token = getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
};
