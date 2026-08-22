/** The write gate. Reads are open, so this is the only thing standing between
 *  a public URL and someone else's shot log. */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import handler, {
  COOKIE_NAME,
  KEY_HEADER,
  checkWriteAccess,
  readCookie,
  tokenFor,
  tokenMatches,
} from "../api/session";

const KEY = "a-passphrase";

function fakeRes() {
  const sent: { status: number; body: any; headers: Record<string, string> } = {
    status: 0,
    body: null,
    headers: {},
  };
  const res: any = {
    status(code: number) {
      sent.status = code;
      return res;
    },
    json(body: unknown) {
      sent.body = body;
    },
    setHeader(name: string, value: string) {
      sent.headers[name.toLowerCase()] = value;
    },
  };
  return { res, sent };
}

const original = process.env.LEDGER_WRITE_KEY;
beforeEach(() => {
  process.env.LEDGER_WRITE_KEY = KEY;
});
afterEach(() => {
  if (original === undefined) delete process.env.LEDGER_WRITE_KEY;
  else process.env.LEDGER_WRITE_KEY = original;
});

describe("readCookie", () => {
  it("finds one cookie among several", () => {
    expect(readCookie("theme=dark; ledger_session=abc; other=1", COOKIE_NAME)).toBe("abc");
  });

  it("handles the header arriving as a list, and values with = in them", () => {
    expect(readCookie(["a=1", "ledger_session=x=y"], COOKIE_NAME)).toBe("x=y");
  });

  it("returns empty for a cookie that isn't there", () => {
    expect(readCookie(undefined, COOKIE_NAME)).toBe("");
    expect(readCookie("theme=dark", COOKIE_NAME)).toBe("");
    // Not a prefix match: ledger_session_other must not answer for it.
    expect(readCookie("ledger_session_other=abc", COOKIE_NAME)).toBe("");
  });
});

describe("tokenMatches", () => {
  it("accepts the hash of the key and nothing else", () => {
    expect(tokenMatches(tokenFor(KEY), KEY)).toBe(true);
    expect(tokenMatches(tokenFor("wrong"), KEY)).toBe(false);
    expect(tokenMatches("", KEY)).toBe(false);
    expect(tokenMatches("short", KEY)).toBe(false);
    // A length mismatch must be a false, not a throw out of timingSafeEqual.
    expect(tokenMatches(tokenFor(KEY) + "0", KEY)).toBe(false);
  });
});

describe("checkWriteAccess", () => {
  it("lets a request through with the key in the header", () => {
    expect(checkWriteAccess({ headers: { [KEY_HEADER]: KEY } })).toBeNull();
  });

  it("lets a request through with the session cookie", () => {
    expect(
      checkWriteAccess({ headers: { cookie: `${COOKIE_NAME}=${tokenFor(KEY)}` } }),
    ).toBeNull();
  });

  it("refuses a request with neither", () => {
    expect(checkWriteAccess({ headers: {} })).toEqual({
      status: 401,
      body: { error: "Wrong key.", needsKey: true },
    });
  });

  it("refuses the wrong key and the wrong cookie", () => {
    expect(checkWriteAccess({ headers: { [KEY_HEADER]: "nope" } })?.status).toBe(401);
    expect(
      checkWriteAccess({ headers: { cookie: `${COOKIE_NAME}=${tokenFor("nope")}` } })?.status,
    ).toBe(401);
  });

  it("does not fall open when the deployment has no key set", () => {
    delete process.env.LEDGER_WRITE_KEY;
    const denied = checkWriteAccess({ headers: { [KEY_HEADER]: "anything" } });
    expect(denied?.status).toBe(503);
    expect((denied?.body as any).needsSetup).toBe(true);
  });
});

describe("POST /api/session", () => {
  it("trades the right key for a long-lived HttpOnly cookie", () => {
    const { res, sent } = fakeRes();
    handler({ method: "POST", body: { key: KEY }, headers: {} }, res);

    expect(sent.status).toBe(200);
    const cookie = sent.headers["set-cookie"];
    expect(cookie).toContain(`${COOKIE_NAME}=${tokenFor(KEY)}`);
    // The hash, never the key itself.
    expect(cookie).not.toContain(KEY);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=31536000");
  });

  it("refuses the wrong key, an empty one, and a missing body", () => {
    for (const body of [{ key: "nope" }, { key: "" }, {}, undefined]) {
      const { res, sent } = fakeRes();
      handler({ method: "POST", body, headers: {} }, res);
      expect(sent.status).toBe(401);
      expect(sent.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("signs out by expiring the cookie", () => {
    const { res, sent } = fakeRes();
    handler({ method: "DELETE", headers: {} }, res);
    expect(sent.status).toBe(200);
    expect(sent.headers["set-cookie"]).toContain("Max-Age=0");
  });

  it("is never cached", () => {
    const { res, sent } = fakeRes();
    handler({ method: "GET", headers: {} }, res);
    expect(sent.headers["cache-control"]).toBe("no-store");
    expect(sent.status).toBe(405);
  });
});
