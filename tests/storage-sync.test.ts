import { afterEach, expect, it, vi } from "vitest";
import { emptyDocument, type AppDocument } from "../src/data";
import { newNote } from "../src/features/notes/model";
import {
  db,
  deleteAll,
  importBackup,
  leaveDemo,
  load,
  parseImport,
  removeNote,
  saveNote,
  savePrefs,
  selectSpace,
  startDemo,
  syncState,
} from "../src/storage";
import {
  applyCloud,
  ConflictError,
  keepThisDevice,
  synchronize,
  type Cloud,
} from "../src/sync";
import { ApiError } from "../src/account-api";

const remote = (doc: AppDocument, revision = 1) => ({ revision, data: doc });
afterEach(async () => {
  await deleteAll();
  selectSpace({ kind: "device" });
  await deleteAll();
});

it("keeps device, account and demo stores separate and tracks unsynced changes", async () => {
  await saveNote(newNote("Device note"));
  selectSpace({ kind: "account", userId: "a1" });
  expect((await load()).notes).toEqual([]);
  const saved = await saveNote(newNote("Account note"));
  expect(await syncState()).toMatchObject({ dirty: true, generation: 1 });
  await removeNote(saved.id);
  expect((await syncState()).generation).toBe(2);
  await deleteAll();
  await startDemo();
  expect((await load()).notes.length).toBeGreaterThan(0);
  await leaveDemo();
  selectSpace({ kind: "device" });
  expect((await load()).notes.map((n) => n.title)).toEqual(["Device note"]);
});

it("validates backups and merges imports by note ID", async () => {
  expect(() => parseImport("not json")).toThrow("not a valid backup");
  expect(() => parseImport(JSON.stringify({ version: 2 }))).toThrow(
    "not a valid backup",
  );
  expect(() => parseImport("x".repeat(10_000_001))).toThrow("10 MB");
  const kept = await saveNote(newNote("Kept"));
  const replaced = await saveNote(newNote("Old title"));
  await importBackup({
    ...emptyDocument(),
    notes: [{ ...replaced, title: "New title" }, newNote("Imported")],
  });
  const titles = (await load()).notes.map((n) => n.title).sort();
  expect(titles).toEqual(["Imported", "Kept", "New title"]);
  expect(kept.id).toBeTruthy();
  const dup = newNote("dup");
  expect(() =>
    parseImport(JSON.stringify({ ...emptyDocument(), notes: [dup, dup] })),
  ).toThrow();
});

it("downloads when clean, uploads when dirty and records the last sync", async () => {
  selectSpace({ kind: "account", userId: "sync" });
  const cloudDoc = { ...emptyDocument(), notes: [newNote("From cloud")] };
  const cloud: Cloud = {
    read: vi.fn().mockResolvedValue(remote(cloudDoc, 2)),
    write: vi.fn().mockResolvedValue({ revision: 3 }),
  };
  expect(await synchronize(db, cloud)).toBe("Synced");
  expect((await load()).notes[0].title).toBe("From cloud");
  expect(cloud.write).not.toHaveBeenCalled();
  const first = (await syncState()).lastSyncedAt;
  expect(first).toBeGreaterThan(0);
  await savePrefs({ ...cloudDoc.preferences, theme: "dark" });
  expect(await synchronize(db, cloud)).toBe("Synced");
  expect(cloud.write).toHaveBeenCalledWith(
    2,
    expect.objectContaining({
      preferences: expect.objectContaining({ theme: "dark" }),
    }),
  );
  expect(await syncState()).toMatchObject({ revision: 3, dirty: false });
  cloud.read = vi.fn().mockRejectedValue(new ApiError("offline", 0));
  await expect(synchronize(db, cloud)).rejects.toThrow("offline");
  expect((await syncState()).lastSyncedAt).toBeGreaterThanOrEqual(first!);
});

it("raises a conflict instead of overwriting, and resolves either way", async () => {
  selectSpace({ kind: "account", userId: "conflict" });
  await saveNote(newNote("Mine"));
  const theirs = { ...emptyDocument(), notes: [newNote("Theirs")] };
  const cloud: Cloud = {
    read: vi.fn().mockResolvedValue(remote(theirs, 4)),
    write: vi.fn().mockResolvedValue({ revision: 5 }),
  };
  const error = await synchronize(db, cloud).catch((e) => e);
  expect(error).toBeInstanceOf(ConflictError);
  expect((await load()).notes[0].title).toBe("Mine");
  await keepThisDevice(error.remote.revision, db, cloud);
  expect(cloud.write).toHaveBeenCalledWith(4, expect.anything());
  expect(await syncState()).toMatchObject({ revision: 5, dirty: false });
  await applyCloud(error.remote);
  expect((await load()).notes.map((n) => n.title)).toEqual(["Theirs"]);
  // A stale write that the server rejects becomes a conflict too.
  await saveNote(newNote("Later"));
  cloud.read = vi.fn().mockResolvedValue(remote(theirs, 4));
  cloud.write = vi.fn().mockRejectedValue(new ApiError("stale", 409));
  await expect(synchronize(db, cloud)).rejects.toBeInstanceOf(ConflictError);
  cloud.write = vi.fn().mockRejectedValue(new ApiError("bad", 400));
  await expect(synchronize(db, cloud)).rejects.toThrow("bad");
});

it("refuses to apply cloud data over a newer local edit", async () => {
  selectSpace({ kind: "account", userId: "race" });
  await expect(applyCloud(remote(emptyDocument(), 1), db, 99)).rejects.toThrow(
    "waiting to sync",
  );
});
