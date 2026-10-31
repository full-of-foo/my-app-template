import Dexie, { type Table } from "dexie";
import { storagePrefix } from "./config";
import {
  documentSchema,
  defaults,
  prefsSchema,
  type AppDocument,
  type Prefs,
} from "./data";
import { noteSchema, sampleNotes, type Note } from "./features/notes/model";

export type SyncState = {
  id: "state";
  revision: number;
  dirty: boolean;
  generation: number;
  lastSyncedAt?: number;
};
export type Space =
  { kind: "device" } | { kind: "account"; userId: string } | { kind: "demo" };

export class AppDB extends Dexie {
  notes!: Table<Note, string>;
  preferences!: Table<Prefs, string>;
  sync!: Table<SyncState, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ notes: "id", preferences: "id", sync: "id" });
  }
}
export const databaseName = (space: Space) =>
  space.kind === "account"
    ? `${storagePrefix}-account-${space.userId}`
    : space.kind === "demo"
      ? `${storagePrefix}-demo`
      : storagePrefix;

/** Device-only records, each account and the sample demo use separate stores. */
export let db = new AppDB(databaseName({ kind: "device" }));
export function selectSpace(space: Space) {
  db.close();
  db = new AppDB(databaseName(space));
  return db;
}
export async function startDemo() {
  await Dexie.delete(databaseName({ kind: "demo" }));
  const demo = selectSpace({ kind: "demo" });
  await demo.notes.bulkPut(sampleNotes());
  await demo.preferences.put({ ...defaults, onboarded: true });
}
export async function leaveDemo() {
  db.close();
  await Dexie.delete(databaseName({ kind: "demo" }));
}

export async function syncState(target = db): Promise<SyncState> {
  return (
    (await target.sync.get("state")) ?? {
      id: "state",
      revision: 0,
      dirty: false,
      generation: 0,
    }
  );
}
async function markDirty(target: AppDB) {
  const state = await syncState(target);
  await target.sync.put({
    ...state,
    dirty: true,
    generation: state.generation + 1,
  });
}
export async function load(target = db): Promise<AppDocument> {
  const [notes, preferences] = await Promise.all([
    target.notes.toArray(),
    target.preferences.get("personal"),
  ]);
  return documentSchema.parse({
    version: 1,
    notes: notes.sort((a, b) => b.updatedAt - a.updatedAt),
    preferences: preferences ? prefsSchema.parse(preferences) : { ...defaults },
  });
}
export async function saveNote(note: Note) {
  const target = db;
  const checked = noteSchema.parse({ ...note, updatedAt: Date.now() });
  await target.transaction("rw", target.notes, target.sync, async () => {
    await target.notes.put(checked);
    await markDirty(target);
  });
  return checked;
}
export async function removeNote(id: string) {
  const target = db;
  await target.transaction("rw", target.notes, target.sync, async () => {
    await target.notes.delete(id);
    await markDirty(target);
  });
}
export async function savePrefs(prefs: Prefs) {
  const target = db;
  await target.transaction("rw", target.preferences, target.sync, async () => {
    await target.preferences.put(prefsSchema.parse(prefs));
    await markDirty(target);
  });
}
export function parseImport(text: string): AppDocument {
  if (text.length > 10_000_000)
    throw Error("Choose a backup smaller than 10 MB.");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw Error("That file is not a valid backup.");
  }
  const result = documentSchema.safeParse(value);
  if (!result.success) throw Error("That file is not a valid backup.");
  return result.data;
}
/** Merges a backup into the current store; notes with the same ID are replaced. */
export async function importBackup(doc: AppDocument) {
  const target = db;
  const checked = parseImport(JSON.stringify(doc));
  await target.transaction(
    "rw",
    target.notes,
    target.preferences,
    target.sync,
    async () => {
      await target.notes.bulkPut(checked.notes);
      await target.preferences.put(checked.preferences);
      await markDirty(target);
    },
  );
}
export async function deleteAll() {
  const target = db;
  await target.transaction(
    "rw",
    target.notes,
    target.preferences,
    target.sync,
    async () => {
      await target.notes.clear();
      await target.preferences.clear();
      await target.sync.clear();
    },
  );
  if ((await target.notes.count()) || (await target.preferences.count()))
    throw Error("Could not verify deletion. Please try again.");
}
