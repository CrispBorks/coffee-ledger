/** A coffee as a bag: how much is left, and where it is in its rest window.
 *
 *  Pure functions over an Entry — no React, no DOM — so the rules are tested
 *  directly rather than through a page.
 */

import type { Entry } from "./ledger-types";
import { daysOffRoast, num } from "./shots";

/* ------------------------------------------------------------ rest window */

export type RestWindow = {
  /** First day off roast it's ready for espresso. */
  from: number;
  /** Last day it's at its best. */
  to: number;
  /** Whether the days were set on this bag or come from its roast level. */
  source: "set" | "roast";
};

/** Rules of thumb for espresso, by roast level. Lighter roasts give off gas
 *  for longer and want more rest; darker ones are ready sooner and fade
 *  sooner. They're starting points — every bag can set its own. */
export const REST_DEFAULTS = {
  light: { from: 14, to: 42 },
  medium: { from: 7, to: 30 },
  dark: { from: 4, to: 21 },
} as const;

export type RoastBand = keyof typeof REST_DEFAULTS;

/** Which band a typed roast level falls in. "Medium-dark" rests like a dark
 *  roast; "light-medium" like a medium; anything unrecognised is medium. */
export function roastBandOf(roastLevel: string): RoastBand {
  const level = roastLevel.toLowerCase();
  if (level.includes("dark")) return "dark";
  if (level.includes("medium")) return "medium";
  if (level.includes("light") || level.includes("nordic")) return "light";
  return "medium";
}

/** The bag's own days where they're set, its roast level's where not. A
 *  window that ends before it starts is ignored rather than trusted. */
export function restWindowOf(entry: Pick<Entry, "restFrom" | "restTo" | "roastLevel">): RestWindow {
  const band = REST_DEFAULTS[roastBandOf(entry.roastLevel)];
  const from = num(entry.restFrom);
  const to = num(entry.restTo);
  const set = from !== null || to !== null;
  const window = {
    from: Math.max(0, Math.round(from ?? band.from)),
    to: Math.max(0, Math.round(to ?? band.to)),
    source: set ? ("set" as const) : ("roast" as const),
  };
  return window.to >= window.from ? window : { ...band, source: "roast" };
}

export type RestPhase =
  | { phase: "resting"; day: number; readyOn: number }
  | { phase: "window"; day: number; until: number }
  | { phase: "past"; day: number; since: number };

/** A calendar day `days` after "YYYY-MM-DD", at local noon (so a clock change
 *  can't push it onto the wrong date). */
export function dayAfter(roastDate: string, days: number): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(roastDate.trim());
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12).getTime();
}

/** Where the bag is in its rest window at `now`, or null without a roast date. */
export function restPhaseOf(
  entry: Pick<Entry, "roastDate" | "restFrom" | "restTo" | "roastLevel">,
  now: number = Date.now(),
): RestPhase | null {
  const day = daysOffRoast(entry.roastDate, now);
  if (day === null) return null;
  const window = restWindowOf(entry);
  const readyOn = dayAfter(entry.roastDate, window.from)!;
  const until = dayAfter(entry.roastDate, window.to)!;
  if (day < window.from) return { phase: "resting", day, readyOn };
  if (day <= window.to) return { phase: "window", day, until };
  return { phase: "past", day, since: until };
}

/** "Oct 24". */
export const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** "Resting · ready Oct 24", "In its window · until Nov 21", "Past its best". */
export function restText(phase: RestPhase): string {
  if (phase.phase === "resting") return `Resting · ready ${shortDate(phase.readyOn)}`;
  if (phase.phase === "window") return `In its window · until ${shortDate(phase.until)}`;
  return "Past its best";
}

/* -------------------------------------------------------------------- bag */

export type Bag = {
  /** Grams left by the count, never below zero. */
  left: number;
  /** Shots left at your recent dose, or null with no dose to go on. */
  shotsLeft: number | null;
  /** Down to about two shots. */
  low: boolean;
  /** Less left than a shot needs: the moment to ask about finishing it. */
  empty: boolean;
  /** Counting down from a weigh-in rather than the bag size. */
  weighed: boolean;
};

/** How many recent doses "your dose" is taken from. Enough to smooth out one
 *  odd shot, few enough to follow a change of basket. */
const RECENT = 5;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** The bag by the count: size (or the last weigh-in) minus every dose logged
 *  since. Null for a coffee with neither a bag size nor a weigh-in — it isn't
 *  being tracked, and "0g left" would be a lie. */
export function bagOf(
  entry: Pick<Entry, "bagGrams" | "weighedGrams" | "weighedAt" | "shots">,
): Bag | null {
  const weighedGrams = num(entry.weighedGrams);
  const weighed = weighedGrams !== null && entry.weighedAt !== null;
  const start = weighed ? weighedGrams : num(entry.bagGrams);
  if (start === null) return null;

  // Only shots pulled after the weigh-in come off it: the ones before are
  // already reflected in what was on the scale.
  const since = weighed ? entry.weighedAt! : -Infinity;
  const used = entry.shots
    .filter((s) => s.pulledAt > since)
    .reduce((sum, s) => sum + (num(s.dose) ?? 0), 0);
  const left = Math.max(0, Math.round((start - used) * 10) / 10);

  const doses = entry.shots
    .map((s) => num(s.dose))
    .filter((d): d is number => d !== null && d > 0)
    .slice(-RECENT);
  const dose = doses.length > 0 ? median(doses) : null;

  const shotsLeft = dose === null ? null : Math.floor(left / dose);
  const empty = dose === null ? left <= 0 : left < dose;
  return { left, shotsLeft, low: !empty && shotsLeft !== null && shotsLeft <= 2, empty, weighed };
}

/** "162g left · ~9 shots", or "16g left · not enough for a shot". */
export function bagText(bag: Bag): string {
  const grams = `${Math.round(bag.left)}g left`;
  if (bag.shotsLeft === null) return grams;
  if (bag.shotsLeft === 0) return `${grams} · not enough for a shot`;
  return `${grams} · ~${bag.shotsLeft} shot${bag.shotsLeft === 1 ? "" : "s"}`;
}

/* --------------------------------------------------------------- finished */

const DAY = 86_400_000;

/** "Finished Oct 30 · 14 shots over 18 days" — what a bag's life came to,
 *  counted from its first shot (or from when it was added, with none). */
export function finishedText(entry: Pick<Entry, "finishedAt" | "createdAt" | "shots">): string {
  if (entry.finishedAt === null) return "";
  const parts = [`Finished ${shortDate(entry.finishedAt)}`];
  const count = entry.shots.length;
  if (count > 0) {
    const first = Math.min(...entry.shots.map((s) => s.pulledAt));
    const days = Math.max(1, Math.round((entry.finishedAt - first) / DAY));
    parts.push(`${count} shot${count === 1 ? "" : "s"} over ${days} day${days === 1 ? "" : "s"}`);
  } else {
    parts.push("no shots logged");
  }
  return parts.join(" · ");
}
