import { useSyncExternalStore } from "react";

const STORAGE_KEY = "coffeeLedger.entries.v1";

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
  extraction: number; // 0–100, under-extracted → over-extracted
  notes: string;
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

export const EMPTY_ENTRY: Omit<Entry, "id" | "createdAt" | "shots"> = {
  coffee: "",
  roaster: "",
  origins: "",
  altitude: "",
  tastingNotes: "",
  roastLevel: "",
  roastDate: "",
  process: "",
  variety: "",
  comments: "",
  machine: "",
  grinder: "",
  basket: "",
  other: "",
};

export const EMPTY_SHOT: Omit<Shot, "id"> = {
  starred: false,
  grind: "",
  dose: "",
  yield: "",
  timeMin: "",
  timeSec: "",
  rpm: "",
  temp: "",
  infusion: "",
  ps: false,
  extraction: 50,
  notes: "",
};

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

let entries: Entry[] = read();
const listeners = new Set<() => void>();

function read(): Entry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function commit(next: Entry[]) {
  entries = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* private mode or quota — the in-memory ledger still works this session */
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Another tab editing the ledger should be reflected here too.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    entries = read();
    listeners.forEach((fn) => fn());
  });
}

export function useEntries(): Entry[] {
  return useSyncExternalStore(
    subscribe,
    () => entries,
    () => entries,
  );
}

export function useEntry(id: string | undefined): Entry | undefined {
  const list = useEntries();
  return list.find((e) => e.id === id);
}

export function addEntry(fields: Omit<Entry, "id" | "createdAt" | "shots">): Entry {
  const entry: Entry = {
    ...fields,
    id: makeId(),
    createdAt: Date.now(),
    shots: [],
  };
  commit([entry, ...entries]);
  return entry;
}

export function updateEntry(id: string, fields: Partial<Entry>) {
  commit(entries.map((e) => (e.id === id ? { ...e, ...fields } : e)));
}

export function deleteEntry(id: string) {
  commit(entries.filter((e) => e.id !== id));
}

export function addShot(entryId: string): string {
  const shot: Shot = { ...EMPTY_SHOT, id: makeId() };
  commit(
    entries.map((e) => (e.id === entryId ? { ...e, shots: [...e.shots, shot] } : e)),
  );
  return shot.id;
}

export function updateShot(entryId: string, shotId: string, fields: Partial<Shot>) {
  commit(
    entries.map((e) =>
      e.id === entryId
        ? {
            ...e,
            shots: e.shots.map((s) => (s.id === shotId ? { ...s, ...fields } : s)),
          }
        : e,
    ),
  );
}

export function deleteShot(entryId: string, shotId: string) {
  commit(
    entries.map((e) =>
      e.id === entryId ? { ...e, shots: e.shots.filter((s) => s.id !== shotId) } : e,
    ),
  );
}

export function matchesQuery(entry: Entry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    entry.coffee,
    entry.roaster,
    entry.origins,
    entry.roastLevel,
    entry.process,
    entry.variety,
    entry.tastingNotes,
    entry.comments,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

export function bestShots(entry: Entry): Shot[] {
  return entry.shots.filter((s) => s.starred);
}
