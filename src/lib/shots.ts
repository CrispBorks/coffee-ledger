/** Reading shots the way someone dialling in reads them: as a ratio, a time,
 *  a taste, and what changed since the last one.
 *
 *  Measurements are stored as the text that was typed ("18", "~18.2", "") —
 *  see ledger-types.ts — so everything here parses leniently and treats
 *  "nothing typed" as nothing, never as zero. Pure functions: no React, no DOM.
 */

import type { Shot } from "./ledger-types";

/** The first number in what was typed: "18,2" → 18.2, "~18.2" → 18.2,
 *  "3.2 (after purge)" → 3.2, "" → null. */
export function num(value: string): number | null {
  const match = /-?\d+(?:[.,]\d+)?/.exec(value.trim());
  if (!match) return null;
  const n = Number(match[0].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ taste */

/** Five steps on the old 0–100 under→over scale, so shots rated with the old
 *  slider land on the nearest step instead of being thrown away. */
export const TASTES = [
  { value: 10, label: "Sour" },
  { value: 30, label: "Slightly sour" },
  { value: 50, label: "Balanced" },
  { value: 70, label: "Slightly bitter" },
  { value: 90, label: "Bitter" },
] as const;

export type Taste = (typeof TASTES)[number];

/** The step a stored value belongs to, or null for "not tasted". */
export function tasteOf(extraction: number | null): Taste | null {
  if (extraction === null) return null;
  const step = Math.round((extraction - 10) / 20);
  return TASTES[Math.min(TASTES.length - 1, Math.max(0, step))];
}

/* ------------------------------------------------------------------- time */

/** Total seconds. Older shots split it into minutes and seconds; a single
 *  seconds field is what a 20–40s shot actually wants, so both read as one. */
export function secondsOf(shot: Pick<Shot, "timeMin" | "timeSec">): number | null {
  const min = num(shot.timeMin);
  const sec = num(shot.timeSec);
  if (min === null && sec === null) return null;
  return Math.round(((min ?? 0) * 60 + (sec ?? 0)) * 10) / 10;
}

/** What goes in the one Time box when editing: what was typed, if it was
 *  typed into seconds alone, otherwise the old minutes:seconds added up. */
export function timeFieldOf(shot: Pick<Shot, "timeMin" | "timeSec">): string {
  if (shot.timeMin.trim() === "") return shot.timeSec;
  const total = secondsOf(shot);
  return total === null ? "" : String(total);
}

/** Written back from the one Time box: all of it in seconds. */
export const withSeconds = (typed: string): Pick<Shot, "timeMin" | "timeSec"> => ({
  timeMin: "",
  timeSec: typed,
});

/* ------------------------------------------------------------------ ratio */

/** "1:2.2", or "" until both weights are in. */
export function ratioOf(dose: string, out: string): string {
  const d = num(dose);
  const y = num(out);
  if (d === null || y === null || d <= 0 || y <= 0) return "";
  return `1:${(y / d).toFixed(1)}`;
}

/** "18g → 40g · 1:2.2 · 28s · grind 3.2" — whatever of it is filled in. */
export function recipeOf(shot: Shot): string {
  const parts: string[] = [];
  const dose = shot.dose.trim();
  const out = shot.yield.trim();
  if (dose || out) parts.push(`${dose ? `${dose}g` : "?"} → ${out ? `${out}g` : "?"}`);
  const ratio = ratioOf(shot.dose, shot.yield);
  if (ratio) parts.push(ratio);
  const seconds = secondsOf(shot);
  if (seconds !== null) parts.push(`${seconds}s`);
  if (shot.grind.trim()) parts.push(`grind ${shot.grind.trim()}`);
  return parts.join(" · ");
}

/* ---------------------------------------------------------------- changes */

export type Change = { label: string; from: string; to: string };

/** The settings worth comparing between two pulls, with how to show each.
 *  Taste and notes aren't here: they're what came out, not what was changed. */
const COMPARED: { label: string; read: (shot: Shot) => string }[] = [
  { label: "grind", read: (s) => s.grind.trim() },
  { label: "dose", read: (s) => (s.dose.trim() ? `${s.dose.trim()}g` : "") },
  { label: "yield", read: (s) => (s.yield.trim() ? `${s.yield.trim()}g` : "") },
  {
    label: "time",
    read: (s) => {
      const seconds = secondsOf(s);
      return seconds === null ? "" : `${seconds}s`;
    },
  },
  { label: "pre-infusion", read: (s) => (s.infusion.trim() ? `${s.infusion.trim()}s` : "") },
  { label: "temp", read: (s) => (s.temp.trim() ? `${s.temp.trim()}°` : "") },
  { label: "rpm", read: (s) => s.rpm.trim() },
];

/** What changed from the shot before: "grind 3.2 → 3.0". The point of a shot
 *  log is seeing which knob moved and what it did. */
export function changesFrom(previous: Shot, shot: Shot): Change[] {
  const changes: Change[] = [];
  for (const { label, read } of COMPARED) {
    const from = read(previous);
    const to = read(shot);
    if (from === to) continue;
    changes.push({ label, from: from || "—", to: to || "—" });
  }
  return changes;
}

/* ------------------------------------------------------------------- time */

/** Whole days between the roast date ("YYYY-MM-DD", from a date input) and a
 *  moment, counted in local calendar days — or null if there's no usable
 *  date, or it's after the moment (a typo, not a roast from the future). */
export function daysOffRoast(roastDate: string, at: number): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(roastDate.trim());
  if (!match) return null;
  const roasted = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const when = new Date(at);
  const day = Date.UTC(when.getFullYear(), when.getMonth(), when.getDate());
  const days = Math.round((day - roasted) / 86_400_000);
  return days >= 0 ? days : null;
}

/** "just now", "12m ago", "3h ago", "2d ago", then a date. */
export function agoText(at: number, now: number = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
