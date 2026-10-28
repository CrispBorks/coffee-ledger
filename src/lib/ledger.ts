/** The ledger, backed by Postgres through /api.
 *
 *  The pages call this the way they always did — `useEntries()`, `addShot()`,
 *  `updateEntry()` — and it still answers instantly from memory. What changed
 *  is what happens after: every change is also queued to the server, so the
 *  ledger follows you between the phone and the laptop instead of living in
 *  one browser's localStorage.
 *
 *  Three rules make that safe to type into:
 *
 *  - **Local first.** A change lands in memory and paints immediately. The
 *    write is a consequence of the edit, never a gate in front of it.
 *  - **Coalesced.** The shot log is edited a character at a time, so writes
 *    for the same row are debounced and collapsed into one — a queued write is
 *    replaced rather than followed, and it re-reads current state when it runs
 *    rather than carrying a stale snapshot.
 *  - **Serial and ordered.** One request is in flight at a time, FIFO. That is
 *    what guarantees a brand-new coffee is inserted before the first shot that
 *    references it, without any of the callers having to await anything.
 *
 *  Nothing is dropped on the floor: a write that fails is held in `failed`,
 *  counted in `unsaved`, and shown by <LedgerStatus /> with a way to retry. */

import { useSyncExternalStore } from "react";

import { authHeader, clearToken, getToken, setToken } from "./auth";
import {
  EMPTY_ENTRY,
  EMPTY_PROFILE,
  EMPTY_SHOT,
  GEAR_FIELDS,
  gearOf,
  makeId,
  toEntry,
  toProfile,
  toShot,
  type Entry,
  type GearField,
  type Profile,
  type Shot,
} from "./ledger-types";
import { chosenTokenProblem, normalizeToken } from "./tokens";

export { EMPTY_ENTRY, EMPTY_PROFILE, EMPTY_SHOT, GEAR_FIELDS, makeId };
export type { Entry, GearField, Profile, Shot };

/** How long a field rests before its row is written. Long enough that typing a
 *  tasting note is one request, short enough that a glance at the save
 *  indicator after a pause tells the truth. */
const DEBOUNCE_MS = 600;

/** A tab coming back to the foreground re-reads the ledger, so the laptop
 *  catches up with what the phone logged — but not on every flick between
 *  tabs. */
const REFRESH_AFTER_MS = 15_000;

export type LedgerState = {
  entries: Entry[];
  /** Whose ledger this is, and the gear every new coffee is added with. */
  profile: Profile;
  /** "locked" until there is a token this server accepts; "loading" until the
   *  first read comes back; "unreachable" if it didn't. */
  status: "locked" | "loading" | "ready" | "unreachable";
  /** Why the ledger couldn't be read, when status is "unreachable" or "locked". */
  loadError: string;
  /** A write is in flight right now. */
  saving: boolean;
  /** Changes not yet acknowledged by the server: queued, waiting, or failed. */
  unsaved: number;
  /** Writes that came back with an error and are being held for a retry. */
  failed: number;
  /** Why the last write failed. */
  writeError: string;
  /** The deployment has no database connected, so nothing can be stored. */
  needsSetup: boolean;
  /** The server can't be reached, and what's on screen is this device's saved
   *  copy. Changes still queue, and go when the connection is back. */
  offline: boolean;
  /** Coffees found in this browser's localStorage from before the database. */
  legacy: number;
};

let state: LedgerState = {
  entries: [],
  profile: EMPTY_PROFILE,
  status: "loading",
  loadError: "",
  saving: false,
  unsaved: 0,
  failed: 0,
  writeError: "",
  needsSetup: false,
  offline: false,
  legacy: 0,
};

const listeners = new Set<() => void>();

function patch(next: Partial<LedgerState>) {
  state = { ...state, ...next, ...counts() };
  listeners.forEach((fn) => fn());
  saveOutbox();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* -------------------------------------------------------------- transport */

type Payload = { error?: string; needsSetup?: boolean } & Record<string, unknown>;

async function request(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: Payload | null }> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: "application/json", ...authHeader(), ...init?.headers },
  });
  const body = await res.text();
  let data: Payload | null = null;
  try {
    data = body ? (JSON.parse(body) as Payload) : null;
  } catch {
    // The SPA rewrite hands back index.html for anything it doesn't recognise,
    // so an HTML body here means the function isn't running — which is exactly
    // what `npm run dev` does. Say so rather than reporting a parse error.
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

const NOT_RUNNING =
  "The /api routes aren't running. `npm run dev` serves the app only — use `vercel dev`, or a deployment.";

/** The server doesn't know this token — it was never issued, or the account is
 *  gone. Back to the gate; the ledger on screen belongs to nobody now. */
function lock(why: string) {
  // The copy belongs to a token that no longer opens anything.
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    /* nothing to do */
  }
  patch({ status: "locked", loadError: why, entries: [] });
}

const REFUSED = "That token isn't recognised.";

/* -------------------------------------------------------------- the queue */

/** "done" — it landed, or there was nothing left to do.
 *  { retry } — it didn't, but the change is still ours to save.
 *  { drop } — it never can; the change is reported and let go. */
type Result = "done" | { retry: string } | { drop: string };

type Job = { key: string; run: () => Promise<Result> };

/** Waiting to be sent, in order. At most one job per key. */
let queue: Job[] = [];
/** Changes still settling, by key — the timer holding each one back, and the
 *  job it will queue. Kept together so a flush can spend the timer early. */
const timers = new Map<string, { timer: ReturnType<typeof setTimeout>; run: () => Promise<Result> }>();
/** Sent, refused, and kept for a retry. */
const failed = new Map<string, Job>();
let running = false;

/** Rows whose writes landed while a read was out. The read may have been
 *  answered from before them, so its copy of those rows is stale: they're laid
 *  over its answer like anything still pending. Null when no read is out. */
let landedDuringRead: Set<string> | null = null;

/** Set while this device's token is being changed. Nothing new is sent until
 *  the new token is in place: a write that left under the old token after the
 *  server had forgotten it would come back 401 and lock the device mid-edit. */
let holding = false;
/** The write in flight, so a token change can let it land first. */
let inFlight: Promise<unknown> = Promise.resolve();

function counts() {
  return {
    saving: running,
    unsaved: queue.length + timers.size + failed.size,
    failed: failed.size,
  };
}

/** Queue a write, replacing any write already queued for the same row. The job
 *  re-reads state when it runs, so replacing is the same as coalescing. */
function enqueue(key: string, run: () => Promise<Result>) {
  const waiting = timers.get(key);
  if (waiting) {
    clearTimeout(waiting.timer);
    timers.delete(key);
  }
  failed.delete(key);

  const at = queue.findIndex((job) => job.key === key);
  if (at === -1) queue.push({ key, run });
  else queue[at] = { key, run };

  patch({});
  void drain();
}

/** Hold a change back until it stops changing. */
function schedule(key: string, run: () => Promise<Result>) {
  const waiting = timers.get(key);
  if (waiting) clearTimeout(waiting.timer);
  timers.set(key, {
    run,
    timer: setTimeout(() => {
      timers.delete(key);
      enqueue(key, run);
    }, DEBOUNCE_MS),
  });
  patch({});
}

/** Drop a queued or waiting write outright — used when the row it would have
 *  written has just been deleted. */
function forget(key: string) {
  const waiting = timers.get(key);
  if (waiting) {
    clearTimeout(waiting.timer);
    timers.delete(key);
  }
  queue = queue.filter((job) => job.key !== key);
  failed.delete(key);
}

/** Set when a write was refused outright, so the ledger is re-read as soon as
 *  the queue is empty and the screen can stop disagreeing with the database. */
let reconcile = false;

async function drain(): Promise<void> {
  if (running || holding) return;
  const job = queue[0];
  if (!job) {
    patch({});
    return;
  }

  running = true;
  patch({});

  let result: Result;
  try {
    const sending = job.run();
    inFlight = sending.catch(() => undefined);
    result = await sending;
  } catch (error) {
    result = { retry: error instanceof Error ? error.message : String(error) };
  }

  running = false;

  // Only drop the job we actually ran. If a newer edit replaced it at the head
  // of the queue while it was in flight, that replacement stays and runs next.
  if (queue[0] === job) queue.shift();

  if (result === "done") {
    landedDuringRead?.add(job.key);
    // The last thing that could still be wrong has gone right.
    patch(failed.size === 0 ? { writeError: "" } : {});
  } else if ("drop" in result) {
    // The change is gone, so what's on screen and what's in the database have
    // parted ways. Say so, and re-read once the queue is quiet again.
    patch({ writeError: result.drop });
    reconcile = true;
  } else {
    // Don't resurrect a job the user has already superseded or deleted.
    if (!queue.some((q) => q.key === job.key) && !timers.has(job.key)) {
      failed.set(job.key, job);
    }
    patch({ writeError: result.retry });
  }

  // Not while anything of ours is still resting in a debounce: a re-read that
  // overwrote a half-typed field would be a worse bug than a stale screen.
  if (reconcile && queue.length === 0 && timers.size === 0 && !holding) {
    reconcile = false;
    void loadLedger(true);
  }

  void drain();
}

/** Send one write and classify what came back. `goneIsFine` is for deletes:
 *  a row that isn't there is the outcome we wanted. */
async function send(
  method: "POST" | "DELETE",
  url: string,
  body?: unknown,
  goneIsFine = false,
): Promise<Result> {
  let res: Awaited<ReturnType<typeof request>>;
  try {
    res = await request(url, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch {
    if (!state.offline) patch({ offline: true });
    return { retry: "Offline — your changes are safe here and will save when the connection is back." };
  }

  if (res.ok) {
    if (state.needsSetup || state.offline) patch({ needsSetup: false, offline: false });
    return "done";
  }
  if (res.status === 404 && goneIsFine) return "done";
  if (res.status === 401) {
    lock(REFUSED);
    return { retry: REFUSED };
  }

  const said = res.data?.error;
  if (res.data === null) return { retry: NOT_RUNNING };

  if (res.status === 503) {
    patch({ needsSetup: true });
    return { retry: said ?? "Saving isn't set up on this deployment." };
  }
  // 400, 409, 413 — the request itself is the problem, so sending it again
  // would fail the same way.
  if (res.status === 400 || res.status === 409 || res.status === 413) {
    return { drop: said ?? `The ledger refused that change (${res.status}).` };
  }
  return { retry: said ?? `The ledger answered ${res.status}.` };
}

/** The profile is one small row, written whole: the server stores a field left
 *  out as blank, so sending all of it every time is what keeps the name from
 *  being wiped by a grinder edit. */
const writeProfile = () => send("POST", "/api/profile", state.profile);

const entryUrl = (id: string) => `/api/entries?id=${encodeURIComponent(id)}`;
const shotUrl = (id: string) => `/api/shots?id=${encodeURIComponent(id)}`;

/** The write for a coffee's own fields. Shots are keyed and written
 *  separately, so they're left out of the body rather than sent and ignored. */
function writeEntry(id: string): () => Promise<Result> {
  return () => {
    const entry = state.entries.find((e) => e.id === id);
    if (!entry) return Promise.resolve<Result>("done");
    const { shots: _shots, ...fields } = entry;
    return send("POST", "/api/entries", fields);
  };
}

function writeShot(entryId: string, shotId: string): () => Promise<Result> {
  return () => {
    const shot = state.entries.find((e) => e.id === entryId)?.shots.find((s) => s.id === shotId);
    if (!shot) return Promise.resolve<Result>("done");
    return send("POST", "/api/shots", { entryId, shot });
  };
}

/* ----------------------------------------------------------------- outbox */

/** Changes that haven't reached the server, kept in localStorage so they
 *  survive the app being closed — on a home-screen app at the machine, on bad
 *  Wi-Fi, that's the moment it happens. The queue holds closures that re-read
 *  state, so what's saved is the state they'd send: a row for a write, an id
 *  for a delete (a pending row key whose row is gone was deleted). */
const OUTBOX_KEY = "coffeeLedger.outbox.v1";

type OutboxOp =
  | { kind: "entry"; entry: Entry }
  | { kind: "deleteEntry"; id: string }
  | { kind: "shot"; entryId: string; shot: Shot }
  | { kind: "deleteShot"; id: string }
  | { kind: "profile"; profile: Profile };

/** Whose changes these are: an outbox never crosses to another ledger. */
type Outbox = { token: string; ops: OutboxOp[] };

let outboxSaved = false;
let outboxRestored = false;

function opFor(key: string): OutboxOp | null {
  if (key === "profile") return { kind: "profile", profile: state.profile };
  if (key.startsWith("entry:")) {
    const id = key.slice("entry:".length);
    const entry = state.entries.find((e) => e.id === id);
    return entry ? { kind: "entry", entry: { ...entry, shots: [] } } : { kind: "deleteEntry", id };
  }
  if (key.startsWith("shot:")) {
    const id = key.slice("shot:".length);
    for (const entry of state.entries) {
      const shot = entry.shots.find((s) => s.id === id);
      if (shot) return { kind: "shot", entryId: entry.id, shot };
    }
    return { kind: "deleteShot", id };
  }
  return null;
}

/** Every row with a change on its way: queued, settling, or held. */
function pendingKeys(): string[] {
  return [...new Set([...queue.map((j) => j.key), ...timers.keys(), ...failed.keys()])];
}

function saveOutbox() {
  // Before the first read the queue can't hold anything worth keeping, and
  // saving now would overwrite the outbox about to be restored.
  if (!outboxRestored) return;
  const keys = pendingKeys();
  try {
    if (keys.length === 0) {
      if (outboxSaved) {
        localStorage.removeItem(OUTBOX_KEY);
        // Everything has landed: this is now the server's state too.
        saveSnapshot();
      }
      outboxSaved = false;
      return;
    }
    const ops = keys.map(opFor).filter((op): op is OutboxOp => op !== null);
    const outbox: Outbox = { token: getToken(), ops };
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
    outboxSaved = true;
  } catch {
    /* private mode or full: the in-memory queue still works this session */
  }
}

function readOutbox(): Outbox | null {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Outbox;
    return Array.isArray(parsed?.ops) && typeof parsed.token === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/** Lay changes over a copy of the ledger: rows replaced or added, deletes
 *  removed. Coffees first, so shots logged against a coffee added offline
 *  have somewhere to go. Used on the server's data after a read, and on the
 *  device's copy at start-up. */
function applyOps(
  entries: Entry[],
  profile: Profile,
  ops: OutboxOp[],
): { entries: Entry[]; profile: Profile } {
  for (const op of ops) {
    if (op.kind === "entry") {
      const incoming = toEntry(op.entry);
      if (!incoming) continue;
      const existing = entries.find((e) => e.id === incoming.id);
      entries = existing
        ? entries.map((e) => (e.id === incoming.id ? { ...incoming, shots: e.shots } : e))
        : [incoming, ...entries];
    } else if (op.kind === "deleteEntry") {
      entries = entries.filter((e) => e.id !== op.id);
    } else if (op.kind === "profile") {
      profile = toProfile(op.profile);
    }
  }
  for (const op of ops) {
    if (op.kind === "shot") {
      const shot = toShot(op.shot);
      if (!shot) continue;
      entries = entries.map((e) =>
        e.id !== op.entryId
          ? e
          : {
              ...e,
              shots: [...e.shots.filter((s) => s.id !== shot.id), shot].sort(
                (a, b) => a.pulledAt - b.pulledAt,
              ),
            },
      );
    } else if (op.kind === "deleteShot") {
      entries = entries.map((e) => ({ ...e, shots: e.shots.filter((s) => s.id !== op.id) }));
    }
  }
  return { entries, profile };
}

/** Put what was left unsent back on screen, and back in the queue — in an
 *  order that's always safe whatever order it was saved in: coffees, then
 *  shots, then deletes, then the profile. */
function restoreOutbox() {
  const outbox = readOutbox();
  if (!outbox) return;
  // Someone else's unsent changes are not this ledger's to send.
  if (outbox.token !== getToken()) {
    try {
      localStorage.removeItem(OUTBOX_KEY);
    } catch {
      /* nothing to do */
    }
    return;
  }

  patch(applyOps(state.entries, state.profile, outbox.ops));

  const order = { entry: 0, shot: 1, deleteShot: 2, deleteEntry: 3, profile: 4 } as const;
  for (const op of [...outbox.ops].sort((a, b) => order[a.kind] - order[b.kind])) {
    if (op.kind === "entry") enqueue(`entry:${op.entry.id}`, writeEntry(op.entry.id));
    else if (op.kind === "shot") enqueue(`shot:${op.shot.id}`, writeShot(op.entryId, op.shot.id));
    else if (op.kind === "deleteShot")
      enqueue(`shot:${op.id}`, () => send("DELETE", shotUrl(op.id), undefined, true));
    else if (op.kind === "deleteEntry")
      enqueue(`entry:${op.id}`, () => send("DELETE", entryUrl(op.id), undefined, true));
    else enqueue("profile", writeProfile);
  }
}

/* --------------------------------------------------------------- snapshot */

/** The last copy of the ledger this device knew the server agreed with. It's
 *  what the app opens on — instantly, and with no connection at all — while
 *  the server is asked for anything newer. Tagged with the token it belongs
 *  to; locking the device deletes it. */
const SNAPSHOT_KEY = "coffeeLedger.snapshot.v1";

function saveSnapshot() {
  try {
    const token = getToken();
    if (!token || state.status !== "ready") return;
    localStorage.setItem(
      SNAPSHOT_KEY,
      JSON.stringify({ token, entries: state.entries, profile: state.profile }),
    );
  } catch {
    /* full or blocked: the app just opens from the server, as before */
  }
}

function readSnapshot(): { entries: Entry[]; profile: Profile } | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: unknown; entries?: unknown; profile?: unknown };
    if (parsed.token !== getToken() || !Array.isArray(parsed.entries)) return null;
    return {
      entries: parsed.entries.map(toEntry).filter((e): e is Entry => e !== null),
      profile: toProfile(parsed.profile),
    };
  } catch {
    return null;
  }
}

/** Nothing of this ledger left on the device: no copy, no unsent changes. */
function forgetDevice() {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
    localStorage.removeItem(OUTBOX_KEY);
  } catch {
    /* nothing to do */
  }
  outboxSaved = false;
}

/** Open the ledger: this device's copy straight away if it has one, unsent
 *  changes on top, then the server for anything newer. */
export function openLedger() {
  if (!getToken()) {
    patch({ status: "locked" });
    return;
  }
  const snapshot = readSnapshot();
  if (snapshot) {
    patch({ ...snapshot, status: "ready" });
    outboxRestored = true;
    restoreOutbox();
  }
  void loadLedger();
}

/* --------------------------------------------------------------- reading */

let lastLoad = 0;
let loadStarted = false;

export async function loadLedger(force = false): Promise<void> {
  if (loadStarted && !force) return;
  loadStarted = true;
  if (force) patch({ status: state.status === "ready" ? "ready" : "loading", loadError: "" });

  let res: Awaited<ReturnType<typeof request>>;
  let profileRes: Awaited<ReturnType<typeof request>> | null;
  const landed = new Set<string>();
  landedDuringRead = landed;
  try {
    // Side by side, and the profile is allowed to fail on its own: a coffee
    // list with blank gear is still a working ledger.
    [res, profileRes] = await Promise.all([
      request("/api/entries"),
      request("/api/profile").catch(() => null),
    ]);
  } catch (error) {
    if (landedDuringRead === landed) landedDuringRead = null;
    // With this device's copy already on screen, no connection just means
    // working from it; without one there's nothing to show.
    if (state.status === "ready") {
      patch({ offline: true });
      return;
    }
    patch({
      status: "unreachable",
      loadError: `Couldn't reach the ledger: ${error instanceof Error ? error.message : String(error)}`,
    });
    return;
  }

  if (landedDuringRead === landed && (!res.ok || res.data === null)) landedDuringRead = null;

  if (res.status === 401 || profileRes?.status === 401) {
    lock(REFUSED);
    return;
  }

  if (!res.ok || res.data === null) {
    if (state.status === "ready" && res.data !== null && res.status !== 503) {
      patch({ offline: true });
      return;
    }
    patch({
      status: "unreachable",
      loadError: res.data === null ? NOT_RUNNING : (res.data.error ?? `The ledger answered ${res.status}.`),
      needsSetup: res.data?.needsSetup === true,
    });
    return;
  }

  const raw = Array.isArray(res.data.entries) ? res.data.entries : [];
  lastLoad = Date.now();
  // What the server says, with this device's newer rows laid on top: anything
  // not sent yet, and anything that landed while the read was out — the read
  // may have been answered from before it.
  const newer = [...new Set([...pendingKeys(), ...landed])]
    .map(opFor)
    .filter((op): op is OutboxOp => op !== null);
  if (landedDuringRead === landed) landedDuringRead = null;
  const merged = applyOps(
    raw.map(toEntry).filter((e): e is Entry => e !== null),
    profileRes?.ok && profileRes.data ? toProfile(profileRes.data.profile) : state.profile,
    newer,
  );
  patch({
    ...merged,
    status: "ready",
    offline: false,
    loadError: "",
    legacy: countLegacy(),
  });

  // Whatever this device hadn't sent when it was last closed goes on top of
  // what the server just said, and is sent now. Once per page life: later
  // reads only happen when nothing is pending.
  if (!outboxRestored) {
    outboxRestored = true;
    restoreOutbox();
  }
  if (pendingKeys().length === 0) saveSnapshot();
}

/** Re-read the ledger, but only when there is nothing of ours in flight — a
 *  refresh that overwrote a half-typed field would be worse than being a few
 *  seconds stale. */
function refreshIfIdle() {
  if (state.status !== "ready") return;
  if (queue.length > 0 || timers.size > 0 || failed.size > 0 || running || holding) return;
  if (Date.now() - lastLoad < REFRESH_AFTER_MS) return;
  void loadLedger(true);
}

/* --------------------------------------------------------------- writing */

function commit(entries: Entry[]) {
  patch({ entries });
}

/** What the Add Coffee form collects: the bag, not the kit (gear comes from
 *  the profile), and nothing that only happens later (a weigh-in, finishing). */
export type NewCoffee = Omit<
  Entry,
  "id" | "createdAt" | "shots" | GearField | "weighedGrams" | "weighedAt" | "finishedAt"
>;

/** A new coffee is added with the gear from your profile, copied onto it —
 *  not linked — so changing grinders later leaves this bag's grind settings
 *  meaning what they meant when you pulled them. */
export function addEntry(fields: NewCoffee): Entry {
  const entry: Entry = {
    ...fields,
    ...gearOf(state.profile),
    weighedGrams: "",
    weighedAt: null,
    finishedAt: null,
    id: makeId(),
    createdAt: Date.now(),
    shots: [],
  };
  commit([entry, ...state.entries]);
  // Immediate, not debounced: the row has to exist before anything can be
  // logged against it, and the caller is already navigating to its page.
  enqueue(`entry:${entry.id}`, writeEntry(entry.id));
  return entry;
}

export function updateProfile(fields: Partial<Profile>) {
  patch({ profile: { ...state.profile, ...fields } });
  schedule("profile", writeProfile);
}

export function updateEntry(id: string, fields: Partial<Entry>) {
  commit(state.entries.map((e) => (e.id === id ? { ...e, ...fields } : e)));
  schedule(`entry:${id}`, writeEntry(id));
}

export function deleteEntry(id: string) {
  const entry = state.entries.find((e) => e.id === id);
  // The shots go with it in the database (on delete cascade), so any write
  // still waiting for one of them would only fail against a row that's gone.
  for (const shot of entry?.shots ?? []) forget(`shot:${shot.id}`);
  forget(`entry:${id}`);

  commit(state.entries.filter((e) => e.id !== id));
  enqueue(`entry:${id}`, () => send("DELETE", entryUrl(id), undefined, true));
}

/** Log a shot, with whatever was filled in, as one write. */
export function addShot(
  entryId: string,
  fields: Partial<Omit<Shot, "id" | "pulledAt">> = {},
): string {
  const shot: Shot = { ...EMPTY_SHOT, ...fields, id: makeId(), pulledAt: Date.now() };
  commit(
    state.entries.map((e) => (e.id === entryId ? { ...e, shots: [...e.shots, shot] } : e)),
  );
  enqueue(`shot:${shot.id}`, writeShot(entryId, shot.id));
  return shot.id;
}

export function updateShot(entryId: string, shotId: string, fields: Partial<Shot>) {
  commit(
    state.entries.map((e) =>
      e.id === entryId
        ? { ...e, shots: e.shots.map((s) => (s.id === shotId ? { ...s, ...fields } : s)) }
        : e,
    ),
  );
  schedule(`shot:${shotId}`, writeShot(entryId, shotId));
}

/** Remove a shot, and hand it back so it can be restored. */
export function deleteShot(entryId: string, shotId: string): Shot | undefined {
  const removed = state.entries
    .find((e) => e.id === entryId)
    ?.shots.find((s) => s.id === shotId);
  forget(`shot:${shotId}`);
  commit(
    state.entries.map((e) =>
      e.id === entryId ? { ...e, shots: e.shots.filter((s) => s.id !== shotId) } : e,
    ),
  );
  enqueue(`shot:${shotId}`, () => send("DELETE", shotUrl(shotId), undefined, true));
  return removed;
}

/** Undo a delete: the same shot, same id, back where it was in the log. It
 *  shares the delete's queue key, so if the delete hasn't been sent yet this
 *  replaces it and the server never hears about either. */
export function restoreShot(entryId: string, shot: Shot) {
  commit(
    state.entries.map((e) => {
      if (e.id !== entryId || e.shots.some((s) => s.id === shot.id)) return e;
      const shots = [...e.shots, shot].sort((a, b) => a.pulledAt - b.pulledAt);
      return { ...e, shots };
    }),
  );
  enqueue(`shot:${shot.id}`, writeShot(entryId, shot.id));
}

/** Send everything that's still resting in a debounce timer, now. Called when
 *  the page is about to go away. */
export function flushPending() {
  for (const [key, waiting] of [...timers]) {
    clearTimeout(waiting.timer);
    timers.delete(key);
    enqueue(key, waiting.run);
  }
}

export function retryFailed() {
  const held = [...failed.values()];
  failed.clear();
  for (const job of held) enqueue(job.key, job.run);
  if (held.length === 0) patch({});
}

/* ------------------------------------------- the ledger that was in a tab */

const LEGACY_KEY = "coffeeLedger.entries.v1";
const LEGACY_DONE = "coffeeLedger.entries.v1.imported";

/** Entries this browser saved before there was a database. Kept, not deleted:
 *  they're read here, offered as an import, and the original key is only
 *  renamed once they're safely in Postgres. */
export function legacyEntries(): Entry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.map(toEntry).filter((e): e is Entry => e !== null);
  } catch {
    return [];
  }
}

const countLegacy = () => legacyEntries().length;

/** Push the browser's old ledger into the database, skipping anything already
 *  there. Awaited rather than queued: it's a one-off with a button waiting on
 *  the result, and it needs to report what actually landed. */
export async function importLegacy(): Promise<{ imported: number; error?: string }> {
  const known = new Set(state.entries.map((e) => e.id));
  const incoming = legacyEntries().filter((e) => !known.has(e.id));

  let imported = 0;
  for (const entry of incoming) {
    const { shots, ...fields } = entry;
    const wrote = await send("POST", "/api/entries", fields);
    if (wrote !== "done") {
      return {
        imported,
        error: typeof wrote === "object" && "retry" in wrote ? wrote.retry : wrote.drop,
      };
    }
    for (const shot of shots) {
      const wroteShot = await send("POST", "/api/shots", { entryId: entry.id, shot });
      if (wroteShot !== "done") {
        return {
          imported,
          error:
            typeof wroteShot === "object" && "retry" in wroteShot
              ? wroteShot.retry
              : wroteShot.drop,
        };
      }
    }
    imported += 1;
  }

  try {
    // Renamed rather than removed — if something about the import was wrong,
    // the only copy of those shots shouldn't be gone with it.
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw !== null) {
      localStorage.setItem(LEGACY_DONE, raw);
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch {
    /* private mode — the import still happened, the banner just comes back */
  }

  await loadLedger(true);
  return { imported };
}

/** Stop offering the import. The local copy is moved aside exactly as a
 *  successful import moves it, so it's still there to be recovered by hand —
 *  what goes away is the banner, for good. */
export function dismissLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw !== null) {
      localStorage.setItem(LEGACY_DONE, raw);
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch {
    /* nothing to do */
  }
  patch({ legacy: 0 });
}

/* ---------------------------------------------------------- who is asking */

/** Forget everything that belongs to whoever was here: the entries on screen
 *  and every write still on its way. Writes are dropped, not kept — they were
 *  made under a token that is about to stop being this device's, and sending
 *  them under the next one would put one person's coffee in another's ledger. */
function resetLedger(next: Partial<LedgerState> = {}) {
  for (const waiting of timers.values()) clearTimeout(waiting.timer);
  timers.clear();
  queue = [];
  failed.clear();
  reconcile = false;
  loadStarted = false;
  lastLoad = 0;
  patch({
    entries: [],
    profile: EMPTY_PROFILE,
    status: "locked",
    loadError: "",
    writeError: "",
    needsSetup: false,
    ...next,
  });
}

/** Ask the server for a brand-new ledger. Nothing is stored yet: the token is
 *  handed back to be shown, and only becomes this device's once the person
 *  confirms they've kept it (see signIn). Until then there's nothing in the
 *  ledger to lose by closing the tab. */
export async function createAccount(): Promise<{ token: string } | { error: string }> {
  let res: Awaited<ReturnType<typeof request>>;
  try {
    res = await request("/api/session", { method: "POST" });
  } catch {
    return { error: "Couldn't reach the server. Check the connection and try again." };
  }

  if (res.data === null) return { error: NOT_RUNNING };
  if (res.status === 503) {
    patch({ needsSetup: true });
    return { error: res.data.error ?? "Saving isn't set up on this deployment." };
  }
  const token = res.data.token;
  if (!res.ok || typeof token !== "string") {
    return { error: res.data.error ?? `The server answered ${res.status}.` };
  }
  return { token };
}

/** Check a token with the server and, if it's good, make it this device's and
 *  load its ledger. A different token than before starts from a clean slate. */
export async function signIn(raw: string): Promise<{ ok: true } | { ok: false; error: string }> {
  // Tidied exactly as the server tidies it, so "Blue Moon " finds "blue moon"
  // and the device keeps the form that will keep matching.
  const token = normalizeToken(raw);
  if (!token) {
    return {
      ok: false,
      error: "That isn't a ledger token — it's the cl_… one you were given, or one you chose (6+ characters).",
    };
  }

  let res: Awaited<ReturnType<typeof request>>;
  try {
    res = await request("/api/session", { headers: { authorization: `Bearer ${token}` } });
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check the connection and try again." };
  }
  if (res.status === 401) return { ok: false, error: REFUSED };
  if (res.data === null) return { ok: false, error: NOT_RUNNING };
  if (!res.ok) {
    if (res.status === 503) patch({ needsSetup: true });
    return { ok: false, error: res.data.error ?? `The server answered ${res.status}.` };
  }

  if (!setToken(token)) {
    return {
      ok: false,
      error: "This browser won't store the token (private mode?), so the ledger would lock itself on reload.",
    };
  }
  // Same token as already loaded: keep the queue and the screen as they are.
  if (token !== currentToken) resetLedger({ status: "loading" });
  currentToken = token;
  await loadLedger(true);
  return { ok: true };
}

/** Swap this ledger's token for one you chose. This device switches to it
 *  straight away; every other device is locked out until it's given the new
 *  one, because the old token stops working the moment this succeeds. */
export async function changeToken(
  raw: string,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const problem = chosenTokenProblem(raw);
  if (problem) return { ok: false, error: problem };

  // Send anything still settling, let the write in flight land under the old
  // token, and hold the rest until the new one is this device's.
  flushPending();
  holding = true;
  try {
    await inFlight;

    let res: Awaited<ReturnType<typeof request>>;
    try {
      res = await request("/api/session", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: raw }),
      });
    } catch {
      return { ok: false, error: "Couldn't reach the server. Your token hasn't changed." };
    }

    if (res.status === 401) {
      lock(REFUSED);
      return { ok: false, error: REFUSED };
    }
    if (res.data === null) return { ok: false, error: NOT_RUNNING };
    const token = res.data.token;
    if (!res.ok || typeof token !== "string") {
      return { ok: false, error: res.data.error ?? `The server answered ${res.status}.` };
    }

    if (!setToken(token)) {
      // The server has already switched, so say plainly what this means.
      return {
        ok: false,
        error: `Changed to "${token}", but this browser won't store it — type it in next time you open the ledger.`,
      };
    }
    currentToken = token;
    return { ok: true, token };
  } finally {
    holding = false;
    if (reconcile && queue.length === 0 && timers.size === 0) {
      reconcile = false;
      void loadLedger(true);
    }
    void drain();
  }
}

/** Take this device out of the ledger. The token isn't revoked — it still works
 *  anywhere it's been kept — but this browser forgets it. */
export function signOut() {
  clearToken();
  currentToken = "";
  resetLedger();
  // Locking the device means it keeps nothing of the ledger.
  forgetDevice();
}

/** The token the loaded ledger belongs to, so signing in again with the same
 *  one doesn't throw away work that hasn't landed yet. */
let currentToken = getToken();

/* ----------------------------------------------------------------- hooks */

const getState = () => state;

/** The same state, without subscribing to it — for the odd caller that only
 *  wants to look, and for the tests. */
export const ledgerState = (): LedgerState => state;

export function useLedger(): LedgerState {
  return useSyncExternalStore(subscribe, getState, getState);
}

export function useEntries(): Entry[] {
  return useSyncExternalStore(
    subscribe,
    () => state.entries,
    () => state.entries,
  );
}

export function useEntry(id: string | undefined): Entry | undefined {
  return useEntries().find((e) => e.id === id);
}

/* ------------------------------------------------------------- selectors */

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

/* ---------------------------------------------------------------- wiring */

if (typeof window !== "undefined") {
  patch({ legacy: countLegacy() });
  // No token, nothing to ask for — go straight to the gate rather than making
  // a request that can only come back 401.
  openLedger();

  // A tab going away takes its debounce timers with it, so spend them first.
  // pagehide, not beforeunload: it's the one iOS Safari actually fires.
  window.addEventListener("pagehide", flushPending);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPending();
    else refreshIfIdle();
  });
  window.addEventListener("online", () => {
    retryFailed();
    refreshIfIdle();
  });

  // Leaving with writes still in the air is worth a word — the browser shows
  // its own wording, this only decides whether it asks at all.
  window.addEventListener("beforeunload", (event) => {
    if (state.unsaved === 0) return;
    event.preventDefault();
    event.returnValue = "";
  });
}
