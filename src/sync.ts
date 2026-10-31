import { db, load, syncState, parseImport, type AppDB } from "./storage";
import { getCloud, putCloud, ApiError } from "./account-api";
import type { AppDocument } from "./data";
export type Cloud = { read: typeof getCloud; write: typeof putCloud };
const service: Cloud = { read: getCloud, write: putCloud };
export class ConflictError extends Error {
  constructor(public remote: { revision: number; data: AppDocument }) {
    super(
      "Another device changed your data. Choose which copy to keep. Nothing has been lost yet.",
    );
  }
}
export async function applyCloud(
  remote: { revision: number; data: AppDocument },
  target: AppDB = db,
  expectedGeneration?: number,
) {
  const checked = parseImport(JSON.stringify(remote.data));
  await target.transaction(
    "rw",
    target.notes,
    target.preferences,
    target.sync,
    async () => {
      const current = await syncState(target);
      if (
        expectedGeneration !== undefined &&
        current.generation !== expectedGeneration
      )
        throw new Error("A new local change is waiting to sync. Try again.");
      await target.notes.clear();
      await target.notes.bulkPut(checked.notes);
      await target.preferences.put(checked.preferences);
      await target.sync.put({
        id: "state",
        revision: remote.revision,
        dirty: false,
        generation: current.generation + 1,
        lastSyncedAt: Date.now(),
      });
    },
  );
}
export async function synchronize(target: AppDB = db, cloud: Cloud = service) {
  const local = await target.transaction(
    "r",
    target.notes,
    target.preferences,
    target.sync,
    async () => ({ data: await load(target), state: await syncState(target) }),
  );
  const remote = await cloud.read();
  if (!local.state.dirty) {
    await applyCloud(remote, target, local.state.generation);
    return "Synced";
  }
  if (local.state.revision !== remote.revision) throw new ConflictError(remote);
  let result: { revision: number };
  try {
    result = await cloud.write(remote.revision, local.data);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409)
      throw new ConflictError(await cloud.read());
    throw error;
  }
  await target.transaction("rw", target.sync, async () => {
    const current = await syncState(target);
    await target.sync.put({
      ...current,
      revision: result.revision,
      dirty: current.generation !== local.state.generation,
      lastSyncedAt: Date.now(),
    });
  });
  return (await syncState(target)).dirty ? "Changes waiting to sync" : "Synced";
}
/** Conflict resolution: replace the cloud copy with this device's data. */
export async function keepThisDevice(
  remoteRevision: number,
  target: AppDB = db,
  cloud: Cloud = service,
) {
  const local = await target.transaction(
    "r",
    target.notes,
    target.preferences,
    target.sync,
    async () => ({ data: await load(target), state: await syncState(target) }),
  );
  const result = await cloud.write(remoteRevision, local.data);
  await target.transaction("rw", target.sync, async () => {
    const current = await syncState(target);
    await target.sync.put({
      ...current,
      revision: result.revision,
      dirty: current.generation !== local.state.generation,
      lastSyncedAt: Date.now(),
    });
  });
}
