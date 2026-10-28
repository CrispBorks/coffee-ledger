import { describe, expect, it } from "vitest";

import {
  bagOf,
  bagText,
  finishedText,
  restPhaseOf,
  restText,
  restWindowOf,
  roastBandOf,
} from "../src/lib/bags";
import { EMPTY_SHOT, type Shot } from "../src/lib/ledger-types";

const shot = (dose: string, pulledAt: number): Shot => ({ ...EMPTY_SHOT, id: `s${pulledAt}`, dose, pulledAt });

const bag = (fields: Partial<Parameters<typeof bagOf>[0]> = {}) => ({
  bagGrams: "",
  weighedGrams: "",
  weighedAt: null,
  shots: [] as Shot[],
  ...fields,
});

describe("bagOf", () => {
  it("isn't tracking a coffee with no bag size and no weigh-in", () => {
    expect(bagOf(bag({ shots: [shot("18", 1)] }))).toBeNull();
  });

  it("counts every logged dose off the bag", () => {
    const b = bagOf(bag({ bagGrams: "250", shots: [shot("18", 1), shot("18.5", 2), shot("", 3)] }));
    expect(b?.left).toBe(213.5);
    // 213.5 / median(18, 18.5) = 213.5 / 18.25 → 11 whole shots
    expect(b?.shotsLeft).toBe(11);
    expect(b?.low).toBe(false);
    expect(b?.empty).toBe(false);
  });

  it("reads what people type, like the rest of the shot log", () => {
    expect(bagOf(bag({ bagGrams: "~250g", shots: [shot("18,5", 1)] }))?.left).toBe(231.5);
  });

  it("counts down from a weigh-in, and only the shots pulled after it", () => {
    const b = bagOf(
      bag({
        bagGrams: "250",
        weighedGrams: "120",
        weighedAt: 1_000,
        shots: [shot("18", 500), shot("18", 1_500)],
      }),
    );
    // The shot at 500 is already reflected in what was on the scale.
    expect(b?.left).toBe(102);
    expect(b?.weighed).toBe(true);
  });

  it("can be tracked from a weigh-in alone, without a bag size", () => {
    expect(bagOf(bag({ weighedGrams: "90", weighedAt: 10, shots: [shot("18", 20)] }))?.left).toBe(72);
  });

  it("says running low at about two shots, and empty when another won't fit", () => {
    const low = bagOf(bag({ bagGrams: "45", shots: [shot("18", 1)] }));
    expect(low).toMatchObject({ left: 27, shotsLeft: 1, low: true, empty: false });

    const empty = bagOf(bag({ bagGrams: "30", shots: [shot("18", 1)] }));
    expect(empty).toMatchObject({ left: 12, shotsLeft: 0, low: false, empty: true });
  });

  it("never reads below zero, however much was logged", () => {
    expect(bagOf(bag({ bagGrams: "36", shots: [shot("18", 1), shot("18", 2), shot("18", 3)] }))?.left).toBe(0);
  });

  it("follows a change of basket: 'your dose' is your recent shots", () => {
    const shots = [1, 2, 3, 4, 5].map((i) => shot("14", i)).concat([6, 7, 8, 9, 10].map((i) => shot("20", i)));
    // 500 - 5×14 - 5×20 = 330; recent dose 20 → 16 shots.
    expect(bagOf(bag({ bagGrams: "500", shots }))?.shotsLeft).toBe(16);
  });

  it("writes it the way the card shows it", () => {
    expect(bagText({ left: 162.4, shotsLeft: 9, low: false, empty: false, weighed: false })).toBe("162g left · ~9 shots");
    expect(bagText({ left: 27, shotsLeft: 1, low: true, empty: false, weighed: false })).toBe("27g left · ~1 shot");
    expect(bagText({ left: 120, shotsLeft: null, low: false, empty: false, weighed: true })).toBe("120g left");
    expect(bagText({ left: 16, shotsLeft: 0, low: false, empty: true, weighed: false })).toBe(
      "16g left · not enough for a shot",
    );
  });
});

describe("rest window", () => {
  it("reads the roast level the way people write it", () => {
    expect(roastBandOf("Light")).toBe("light");
    expect(roastBandOf("Nordic light")).toBe("light");
    expect(roastBandOf("Light-medium")).toBe("medium");
    expect(roastBandOf("Medium-dark")).toBe("dark");
    expect(roastBandOf("Dark")).toBe("dark");
    expect(roastBandOf("")).toBe("medium");
    expect(roastBandOf("omni")).toBe("medium");
  });

  it("uses the roast level's window unless the bag sets its own", () => {
    expect(restWindowOf({ roastLevel: "Light", restFrom: "", restTo: "" })).toEqual({ from: 14, to: 42, source: "roast" });
    expect(restWindowOf({ roastLevel: "Light", restFrom: "21", restTo: "" })).toEqual({ from: 21, to: 42, source: "set" });
    expect(restWindowOf({ roastLevel: "Dark", restFrom: "3", restTo: "15" })).toEqual({ from: 3, to: 15, source: "set" });
  });

  it("ignores a window that ends before it starts", () => {
    expect(restWindowOf({ roastLevel: "Medium", restFrom: "30", restTo: "10" })).toEqual({
      from: 7,
      to: 30,
      source: "roast",
    });
  });

  const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 9).getTime();
  const light = { roastLevel: "Light", restFrom: "", restTo: "", roastDate: "2026-10-12" };

  it("is resting until the window opens, and says when it will", () => {
    const phase = restPhaseOf(light, at(2026, 10, 20));
    expect(phase).toMatchObject({ phase: "resting", day: 8 });
    expect(new Date(phase!.phase === "resting" ? phase!.readyOn : 0).getDate()).toBe(26);
    expect(restText(phase!)).toMatch(/^Resting · ready /);
  });

  it("is in its window from the first day to the last, inclusive", () => {
    expect(restPhaseOf(light, at(2026, 10, 26))?.phase).toBe("window");
    expect(restPhaseOf(light, at(2026, 11, 23))?.phase).toBe("window");
    expect(restText(restPhaseOf(light, at(2026, 11, 1))!)).toMatch(/^In its window · until /);
  });

  it("is past its best after that", () => {
    const phase = restPhaseOf(light, at(2026, 11, 24));
    expect(phase?.phase).toBe("past");
    expect(restText(phase!)).toBe("Past its best");
  });

  it("has nothing to say without a roast date", () => {
    expect(restPhaseOf({ ...light, roastDate: "" })).toBeNull();
  });
});

describe("finishedText", () => {
  const DAY = 86_400_000;
  const end = new Date(2026, 9, 30, 12).getTime();

  it("says when, how many shots, and over how long", () => {
    const shots = [shot("18", end - 18 * DAY), shot("18", end - 2 * DAY)];
    expect(finishedText({ finishedAt: end, createdAt: 0, shots })).toMatch(
      /^Finished .+ · 2 shots over 18 days$/,
    );
  });

  it("handles a bag with one shot, or none", () => {
    expect(finishedText({ finishedAt: end, createdAt: 0, shots: [shot("18", end)] })).toMatch(
      /· 1 shot over 1 day$/,
    );
    expect(finishedText({ finishedAt: end, createdAt: 0, shots: [] })).toMatch(/· no shots logged$/);
  });

  it("is empty for a bag still in use", () => {
    expect(finishedText({ finishedAt: null, createdAt: 0, shots: [] })).toBe("");
  });
});
