/** The shapes the ledger stores, and the tidying both ends agree on.
 *
 *  Shared by the browser app and the serverless functions, so it holds nothing
 *  either one can't load: no React, no DOM, no database client. The store in
 *  ledger.ts re-exports all of it, so the pages carry on importing from there.
 */

/** One pull. Every measurement is a string because that is what the shot log
 *  actually collects — a field left blank, "18", "18.2" and "~18" are all
 *  things you type at 7am, and round-tripping them through a number turns the
 *  blanks into zeroes and the rest into a lie about how precisely it was
 *  weighed. Aggregating them is a job for a view over the table, later. */
export type Shot = {
  id: string;
  starred: boolean;
  grind: string;
  dose: string;
  yield: string;
  timeMin: string;
  timeSec: string;
  rpm: string;
  temp: string;
  infusion: string;
  ps: boolean;
  /** How it tasted, 0 (sour, under-extracted) to 100 (bitter, over-extracted);
   *  null until it has been tasted. It used to default to 50, which made every
   *  shot nobody rated look balanced. */
  extraction: number | null;
  notes: string;
  /** When it was pulled, in ms. Set by the device that logs it, and what orders
   *  the shot log — so a deleted shot that's restored goes back where it was. */
  pulledAt: number;
};

export type Entry = {
  id: string;
  createdAt: number;
  // Coffee
  coffee: string;
  roaster: string;
  origins: string;
  altitude: string;
  tastingNotes: string;
  // Roast
  roastLevel: string;
  roastDate: string;
  process: string;
  variety: string;
  comments: string;
  // Gear
  machine: string;
  grinder: string;
  basket: string;
  other: string;
  // Shots
  shots: Shot[];
};

/** The editable text of an entry, in one list, so the empty entry, the
 *  validator and the row mapper can't drift apart as fields are added. */
export const ENTRY_TEXT_FIELDS = [
  "coffee",
  "roaster",
  "origins",
  "altitude",
  "tastingNotes",
  "roastLevel",
  "roastDate",
  "process",
  "variety",
  "comments",
  "machine",
  "grinder",
  "basket",
  "other",
] as const;

export type EntryTextField = (typeof ENTRY_TEXT_FIELDS)[number];

/** What an entry looks like before anything is typed into it. */
export const EMPTY_ENTRY = Object.fromEntries(
  ENTRY_TEXT_FIELDS.map((field) => [field, ""]),
) as Record<EntryTextField, string>;

export const SHOT_TEXT_FIELDS = [
  "grind",
  "dose",
  "yield",
  "timeMin",
  "timeSec",
  "rpm",
  "temp",
  "infusion",
  "notes",
] as const;

export type ShotTextField = (typeof SHOT_TEXT_FIELDS)[number];

export const EMPTY_SHOT: Omit<Shot, "id" | "pulledAt"> = {
  ...(Object.fromEntries(SHOT_TEXT_FIELDS.map((f) => [f, ""])) as Record<
    ShotTextField,
    string
  >),
  starred: false,
  ps: false,
  extraction: null,
};

/** Ids are made in the browser so a new coffee has a URL before the write to
 *  the database has come back. That means the server has to treat them as
 *  untrusted input: this is the shape it will accept. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const flag = (value: unknown) => value === true;

/** Missing means not tasted. Otherwise clamped rather than rejected: the app
 *  only produces 0–100, so a value outside it means something else wrote the
 *  row, and the nearest end of the scale beats refusing to show the shot. */
const extraction = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
};

/** A time in ms, or now. */
const instant = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : Date.now();

/** Coerce anything shaped roughly like a shot into a whole one. Used on both
 *  sides: the server won't store a half-filled row, and the client won't hand
 *  a page an object with fields missing. */
export function toShot(value: unknown): Shot | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !ID_PATTERN.test(raw.id)) return null;

  const shot = { id: raw.id } as Shot;
  for (const field of SHOT_TEXT_FIELDS) shot[field] = text(raw[field]);
  shot.starred = flag(raw.starred);
  shot.ps = flag(raw.ps);
  shot.extraction = extraction(raw.extraction);
  shot.pulledAt = instant(raw.pulledAt);
  return shot;
}

export function toEntry(value: unknown): Entry | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !ID_PATTERN.test(raw.id)) return null;

  const entry = { id: raw.id } as Entry;
  for (const field of ENTRY_TEXT_FIELDS) entry[field] = text(raw[field]);
  entry.createdAt =
    typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
      ? raw.createdAt
      : Date.now();
  entry.shots = Array.isArray(raw.shots)
    ? raw.shots.map(toShot).filter((s): s is Shot => s !== null)
    : [];
  return entry;
}

/** A backstop against a single request filling the table. The form has no way
 *  to produce anything close to this; a script pointed at the API does. */
export const MAX_ENTRY_BYTES = 200_000;

/* ---------------------------------------------------------------- profile */

/** The gear a coffee is dialled in on. It lives on the profile because it
 *  hardly ever changes, and is copied onto each coffee as it's added — so a
 *  new grinder next year doesn't quietly rewrite what "3.2" meant on every bag
 *  logged before it. Grind settings are only meaningful against the grinder
 *  they were set on. */
export const GEAR_FIELDS = ["machine", "grinder", "basket", "other"] as const satisfies readonly EntryTextField[];

export type GearField = (typeof GEAR_FIELDS)[number];

/** One person's side of the ledger: what to call them, and their gear. */
export type Profile = { name: string } & Record<GearField, string>;

export const PROFILE_FIELDS = ["name", ...GEAR_FIELDS] as const;

export const EMPTY_PROFILE: Profile = {
  name: "",
  machine: "",
  grinder: "",
  basket: "",
  other: "",
};

/** Longer than any machine or grinder name; short enough that a profile can't
 *  be used to park a document. */
export const MAX_PROFILE_FIELD_LENGTH = 200;

/** A whole profile from whatever arrived, with anything missing left blank —
 *  so a request that mentions only the grinder can't blank the name by
 *  leaving it out; it has to send it. */
export function toProfile(value: unknown): Profile {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const profile = { ...EMPTY_PROFILE };
  for (const field of PROFILE_FIELDS) profile[field] = text(raw[field]);
  return profile;
}

/** Just the gear, for copying onto a coffee. */
export function gearOf(profile: Profile): Record<GearField, string> {
  return {
    machine: profile.machine,
    grinder: profile.grinder,
    basket: profile.basket,
    other: profile.other,
  };
}
