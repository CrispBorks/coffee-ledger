import { describe, expect, it } from "vitest";

import { chosenToken, chosenTokenProblem, normalizeToken } from "../src/lib/tokens";

const issued = "cl_" + "AbC-_9".repeat(7) + "x";

describe("normalizeToken", () => {
  it("passes an issued token through exactly, case and all", () => {
    expect(issued).toHaveLength(46);
    expect(normalizeToken(issued)).toBe(issued);
    expect(normalizeToken(`  ${issued}\n`)).toBe(issued);
  });

  it("tidies a chosen token the way it was tidied when chosen", () => {
    expect(normalizeToken("Blue Moon")).toBe("blue moon");
    expect(normalizeToken("  blue\t  moon ")).toBe("blue moon");
    expect(normalizeToken("Yash-Espresso_2.0")).toBe("yash-espresso_2.0");
  });

  it("returns nothing for what can't be a token of either kind", () => {
    for (const bad of ["", "   ", "short", "café crème", "cl_toolong" + "x".repeat(60), "x".repeat(65)]) {
      expect(normalizeToken(bad), JSON.stringify(bad)).toBe("");
    }
  });

  it("never turns a mangled issued token into a chosen one", () => {
    // Lowercased by autocorrect, a cl_ token is still shaped like an issued
    // one, so it is matched exactly — as a different token that opens nothing
    // — rather than tidied into some chosen token that might.
    const lowered = issued.toLowerCase();
    expect(normalizeToken(lowered)).toBe(lowered);
    expect(normalizeToken(lowered)).not.toBe(issued);
    // And nothing starting cl_ can ever be chosen.
    expect(chosenTokenProblem(lowered)).not.toBeNull();
  });
});

describe("chosenTokenProblem", () => {
  it("accepts six characters and up", () => {
    expect(chosenTokenProblem("abcdef")).toBeNull();
    expect(chosenTokenProblem("abcde")).toMatch(/at least 6/);
  });

  it("counts length after tidying, so padding doesn't make a short token long enough", () => {
    expect(chosenTokenProblem("  abc  ")).toMatch(/at least 6/);
  });

  it("says what is wrong in words someone can act on", () => {
    expect(chosenTokenProblem("café crème")).toMatch(/letters, numbers/);
    expect(chosenTokenProblem("x".repeat(65))).toMatch(/at most 64/);
    expect(chosenTokenProblem("cl_something")).toMatch(/cl_/);
  });

  it("agrees with chosenToken", () => {
    for (const raw of ["Blue Moon", "short", "café crème", "Good One 42"]) {
      expect(chosenToken(raw) === "", raw).toBe(chosenTokenProblem(raw) !== null);
    }
  });
});
