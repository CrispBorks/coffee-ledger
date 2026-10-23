import { describe, expect, it } from "vitest";

import {
  EMPTY_ENTRY,
  EMPTY_SHOT,
  ENTRY_TEXT_FIELDS,
  ID_PATTERN,
  makeId,
  toEntry,
  toShot,
} from "../src/lib/ledger-types";

describe("toShot", () => {
  it("fills in every field a partial shot left out", () => {
    const shot = toShot({ id: "abc", dose: "18" });
    expect(shot).toEqual({ ...EMPTY_SHOT, id: "abc", dose: "18" });
  });

  it("refuses a shot without a usable id", () => {
    expect(toShot({ dose: "18" })).toBeNull();
    expect(toShot({ id: "" })).toBeNull();
    expect(toShot({ id: "has spaces" })).toBeNull();
    expect(toShot({ id: "x".repeat(65) })).toBeNull();
    expect(toShot(null)).toBeNull();
    expect(toShot("abc")).toBeNull();
  });

  it("keeps measurements as the text that was typed", () => {
    // Blank means "not weighed", which a number would turn into a zero.
    expect(toShot({ id: "a", dose: "" })?.dose).toBe("");
    expect(toShot({ id: "a", dose: "~18.2" })?.dose).toBe("~18.2");
  });

  it("coerces the flags rather than trusting them", () => {
    expect(toShot({ id: "a", starred: "yes" })?.starred).toBe(false);
    expect(toShot({ id: "a", starred: true })?.starred).toBe(true);
    expect(toShot({ id: "a", ps: 1 })?.ps).toBe(false);
  });

  it("clamps extraction onto the slider's scale", () => {
    expect(toShot({ id: "a", extraction: -20 })?.extraction).toBe(0);
    expect(toShot({ id: "a", extraction: 900 })?.extraction).toBe(100);
    expect(toShot({ id: "a", extraction: 61.6 })?.extraction).toBe(62);
    expect(toShot({ id: "a", extraction: "nope" })?.extraction).toBe(50);
    expect(toShot({ id: "a" })?.extraction).toBe(50);
  });
});

describe("toEntry", () => {
  it("fills in every text field, so an omission can't blank a column", () => {
    const entry = toEntry({ id: "abc", coffee: "Kochere" });
    for (const field of ENTRY_TEXT_FIELDS) {
      expect(typeof entry?.[field]).toBe("string");
    }
    expect(entry?.coffee).toBe("Kochere");
    expect(entry?.roaster).toBe("");
  });

  it("refuses an entry without a usable id", () => {
    expect(toEntry({ coffee: "Kochere" })).toBeNull();
    expect(toEntry({ id: "a b" })).toBeNull();
  });

  it("drops shots it can't make sense of and keeps the rest", () => {
    const entry = toEntry({
      id: "abc",
      shots: [{ id: "s1", dose: "18" }, { dose: "19" }, "nonsense"],
    });
    expect(entry?.shots.map((s) => s.id)).toEqual(["s1"]);
  });

  it("defaults createdAt rather than storing NaN", () => {
    expect(toEntry({ id: "abc", createdAt: "yesterday" })?.createdAt).toBeTypeOf("number");
    expect(toEntry({ id: "abc", createdAt: 1234 })?.createdAt).toBe(1234);
  });
});

describe("ids", () => {
  it("makes ids the server will accept", () => {
    for (let i = 0; i < 50; i += 1) expect(ID_PATTERN.test(makeId())).toBe(true);
  });

  it("does not collide within a tick", () => {
    const ids = new Set(Array.from({ length: 500 }, makeId));
    expect(ids.size).toBe(500);
  });
});

describe("EMPTY_ENTRY", () => {
  it("covers exactly the fields the form edits", () => {
    expect(Object.keys(EMPTY_ENTRY).sort()).toEqual([...ENTRY_TEXT_FIELDS].sort());
    expect(Object.values(EMPTY_ENTRY).every((v) => v === "")).toBe(true);
  });
});
