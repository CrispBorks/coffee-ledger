import { describe, expect, it } from "vitest";

import { EMPTY_SHOT, type Shot } from "../src/lib/ledger-types";
import {
  agoText,
  changesFrom,
  daysOffRoast,
  num,
  ratioOf,
  recipeOf,
  secondsOf,
  tasteOf,
  timeFieldOf,
  withSeconds,
} from "../src/lib/shots";

const shot = (fields: Partial<Shot> = {}): Shot => ({
  ...EMPTY_SHOT,
  id: "s",
  pulledAt: 1,
  ...fields,
});

describe("num", () => {
  it("reads what people actually type", () => {
    expect(num("18")).toBe(18);
    expect(num("18.2")).toBe(18.2);
    expect(num("18,2")).toBe(18.2);
    expect(num("~18.2")).toBe(18.2);
    expect(num(" 3.2 (after purge)")).toBe(3.2);
  });

  it("treats nothing typed as nothing, never zero", () => {
    expect(num("")).toBeNull();
    expect(num("   ")).toBeNull();
    expect(num("fine")).toBeNull();
  });
});

describe("taste", () => {
  it("is not tasted until rated", () => {
    expect(tasteOf(null)).toBeNull();
  });

  it("puts each stored step on its own label", () => {
    expect([10, 30, 50, 70, 90].map((v) => tasteOf(v)?.label)).toEqual([
      "Sour",
      "Slightly sour",
      "Balanced",
      "Slightly bitter",
      "Bitter",
    ]);
  });

  it("buckets old slider values to the nearest step", () => {
    expect(tasteOf(0)?.label).toBe("Sour");
    expect(tasteOf(19)?.label).toBe("Sour");
    expect(tasteOf(21)?.label).toBe("Slightly sour");
    expect(tasteOf(62)?.label).toBe("Slightly bitter");
    expect(tasteOf(100)?.label).toBe("Bitter");
  });
});

describe("time", () => {
  it("adds up the old minutes and seconds", () => {
    expect(secondsOf(shot({ timeMin: "1", timeSec: "5" }))).toBe(65);
    expect(secondsOf(shot({ timeMin: "0", timeSec: "28" }))).toBe(28);
    expect(secondsOf(shot({ timeMin: "", timeSec: "28.5" }))).toBe(28.5);
    expect(secondsOf(shot())).toBeNull();
  });

  it("round-trips through the single seconds box", () => {
    // An old split time is shown as its total...
    expect(timeFieldOf(shot({ timeMin: "1", timeSec: "5" }))).toBe("65");
    // ...and written back as seconds alone.
    expect(withSeconds("65")).toEqual({ timeMin: "", timeSec: "65" });
    // Typed into seconds alone, it comes back exactly as typed.
    expect(timeFieldOf(shot(withSeconds("~28")))).toBe("~28");
  });
});

describe("ratio", () => {
  it("is yield over dose, to one place", () => {
    expect(ratioOf("18", "40")).toBe("1:2.2");
    expect(ratioOf("18", "36")).toBe("1:2.0");
    expect(ratioOf("18,5", "~41")).toBe("1:2.2");
  });

  it("waits for both weights", () => {
    expect(ratioOf("18", "")).toBe("");
    expect(ratioOf("", "40")).toBe("");
    expect(ratioOf("0", "40")).toBe("");
  });

  it("reads as a recipe line with whatever's filled in", () => {
    expect(recipeOf(shot({ dose: "18", yield: "40", timeSec: "28", grind: "3.2" }))).toBe(
      "18g → 40g · 1:2.2 · 28s · grind 3.2",
    );
    expect(recipeOf(shot({ grind: "3.2" }))).toBe("grind 3.2");
    expect(recipeOf(shot())).toBe("");
  });
});

describe("changesFrom", () => {
  const before = shot({ grind: "3.2", dose: "18", yield: "40", timeSec: "28" });

  it("names the knob that moved, and where to", () => {
    expect(changesFrom(before, { ...before, grind: "3.0" })).toEqual([
      { label: "grind", from: "3.2", to: "3.0" },
    ]);
  });

  it("lists every change, in a dialling-in order", () => {
    const after = { ...before, grind: "3.0", timeSec: "31", infusion: "8" };
    expect(changesFrom(before, after).map((c) => c.label)).toEqual(["grind", "time", "pre-infusion"]);
  });

  it("doesn't mention pre-soak, which the app no longer shows", () => {
    expect(changesFrom(before, { ...before, ps: true })).toEqual([]);
  });

  it("compares times in seconds, whatever way they were stored", () => {
    const old = shot({ timeMin: "0", timeSec: "28" });
    expect(changesFrom(old, shot(withSeconds("28")))).toEqual([]);
  });

  it("shows a field that was emptied or newly filled", () => {
    expect(changesFrom(before, { ...before, yield: "" })).toEqual([
      { label: "yield", from: "40g", to: "—" },
    ]);
  });

  it("ignores taste and notes — they're the result, not the change", () => {
    expect(changesFrom(before, { ...before, extraction: 90, notes: "bitter" })).toEqual([]);
  });
});

describe("daysOffRoast", () => {
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

  it("counts calendar days since the roast", () => {
    expect(daysOffRoast("2026-10-12", at(2026, 10, 28))).toBe(16);
    expect(daysOffRoast("2026-10-12", at(2026, 10, 12, 0))).toBe(0);
    expect(daysOffRoast("2026-10-12", at(2026, 10, 12, 23))).toBe(0);
  });

  it("gives nothing for no date, a bad date, or one in the future", () => {
    expect(daysOffRoast("", at(2026, 10, 28))).toBeNull();
    expect(daysOffRoast("last week", at(2026, 10, 28))).toBeNull();
    expect(daysOffRoast("2026-11-01", at(2026, 10, 28))).toBeNull();
  });
});

describe("agoText", () => {
  const now = Date.UTC(2026, 9, 28, 12);
  it("reads like someone would say it", () => {
    expect(agoText(now - 20_000, now)).toBe("just now");
    expect(agoText(now - 12 * 60_000, now)).toBe("12m ago");
    expect(agoText(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(agoText(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});
