import { useCallback, useEffect, useRef, useState } from "react";
import { storagePrefix } from "./config";
import { emptyDocument, type AppDocument, type Prefs } from "./data";
import type { Note } from "./features/notes/model";
import {
  ApiError,
  deleteAccount as deleteRemoteAccount,
  eraseCloud,
  getSession,
  signOut as signOutRemote,
  userSchema,
  type User,
} from "./account-api";
import {
  databaseName,
  deleteAll,
  importBackup,
  leaveDemo as dropDemo,
  load,
  removeNote as removeLocalNote,
  saveNote as saveLocalNote,
  savePrefs,
  selectSpace,
  startDemo as seedDemo,
  syncState,
  type Space,
} from "./storage";
import { applyCloud, ConflictError, keepThisDevice, synchronize } from "./sync";
import Dexie from "dexie";

const lastAccountKey = `${storagePrefix}-last-account`;
const spaceKey = `${storagePrefix}-space`;
function remember(key: string, value?: string) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* Storage can be unavailable in private windows; nothing else depends on it. */
  }
}
function recall(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lastAccount(): User | null {
  try {
    return userSchema.parse(JSON.parse(recall(lastAccountKey) ?? "null"));
  } catch {
    return null;
  }
}

export type SyncView = {
  status: string;
  attention: string;
  lastSyncedAt?: number;
  needsSignIn: boolean;
  conflict: ConflictError | null;
};
const idle: SyncView = {
  status: "Saved on this device",
  attention: "",
  needsSignIn: false,
  conflict: null,
};

/** All app-wide state and actions. Screens receive what they need from here. */
export function useAppState() {
  const [ready, setReady] = useState(false);
  const [space, setSpace] = useState<Space | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [doc, setDoc] = useState<AppDocument>(emptyDocument());
  const [sync, setSync] = useState<SyncView>(idle);
  const [offline, setOffline] = useState(() => !navigator.onLine);
  const [error, setError] = useState("");
  const running = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const refresh = useCallback(async () => setDoc(await load()), []);

  const syncNow = useCallback(async () => {
    if (!user || space?.kind !== "account") return;
    if (running.current) return running.current;
    const task = (async () => {
      setSync((s) => ({ ...s, status: "Syncing…" }));
      try {
        const message = await synchronize();
        setOffline(false);
        setSync({
          status: message,
          attention: "",
          needsSignIn: false,
          conflict: null,
          lastSyncedAt: (await syncState()).lastSyncedAt,
        });
        await refresh();
      } catch (error) {
        const expired = error instanceof ApiError && error.status === 401;
        const temporary =
          error instanceof ApiError &&
          (error.status === 0 || error.status >= 500);
        const message = expired
          ? "Sign in again to sync. Your saved changes are still on this device."
          : temporary
            ? "Sync is unavailable right now. We’ll try again automatically."
            : error instanceof Error
              ? error.message
              : "Sync needs attention. Your changes are still on this device.";
        setSync({
          status: message,
          attention: temporary ? "" : message,
          needsSignIn: expired,
          conflict: error instanceof ConflictError ? error : null,
          lastSyncedAt: (await syncState()).lastSyncedAt,
        });
      } finally {
        running.current = null;
      }
    })();
    running.current = task;
    return task;
  }, [user, space, refresh]);

  const scheduleSync = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void syncNow(), 800);
  }, [syncNow]);

  const open = useCallback(
    async (next: Space, account: User | null) => {
      selectSpace(next);
      setSpace(next);
      setUser(account);
      setSync({ ...idle, lastSyncedAt: (await syncState()).lastSyncedAt });
      await refresh();
    },
    [refresh],
  );

  // Startup: restore the last space without asking again.
  useEffect(() => {
    let active = true;
    void (async () => {
      const previous = lastAccount();
      let session: User | null = null;
      let unreachable = false;
      try {
        session = await getSession();
      } catch {
        unreachable = true;
      }
      if (!active) return;
      try {
        if (session) {
          remember(lastAccountKey, JSON.stringify(session));
          await open({ kind: "account", userId: session.id }, session);
        } else if (previous) {
          // Offline or signed out elsewhere: keep this account's records usable.
          await open({ kind: "account", userId: previous.id }, previous);
          if (!unreachable)
            setSync((s) => ({
              ...s,
              needsSignIn: true,
              status:
                "Sign in again to sync. Your saved changes are still on this device.",
              attention:
                "Sign in again to sync. Your saved changes are still on this device.",
            }));
        } else if (recall(spaceKey) === "device") {
          await open({ kind: "device" }, null);
        }
      } catch {
        setError(
          "This device can’t save records right now. Try reopening the app.",
        );
      }
      if (active) setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [open]);

  // Quiet background sync while the app is open.
  useEffect(() => {
    if (space?.kind !== "account" || !user) return;
    void syncNow();
    const online = () => {
      setOffline(false);
      void syncNow();
    };
    const wentOffline = () => setOffline(true);
    // A sync that raced the session swap may have failed; retry with the new session.
    const renewed = () =>
      void Promise.resolve(running.current)
        .catch(() => undefined)
        .then(() => syncNow());
    window.addEventListener("online", online);
    window.addEventListener("offline", wentOffline);
    window.addEventListener("account:session-renewed", renewed);
    const interval = setInterval(() => void syncNow(), 60_000);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", wentOffline);
      window.removeEventListener("account:session-renewed", renewed);
      clearInterval(interval);
      clearTimeout(timer.current);
    };
  }, [space, user, syncNow]);

  const changed = useCallback(async () => {
    await refresh();
    if (space?.kind === "account") scheduleSync();
  }, [refresh, scheduleSync, space]);

  return {
    ready,
    space,
    user,
    doc,
    sync,
    offline,
    error,
    async useDevice() {
      remember(spaceKey, "device");
      await open({ kind: "device" }, null);
      await savePrefs({ ...(await load()).preferences, onboarded: true });
      await refresh();
    },
    async startDemo() {
      await seedDemo();
      setSpace({ kind: "demo" });
      setUser(null);
      setSync(idle);
      await refresh();
    },
    async leaveDemo() {
      await dropDemo();
      selectSpace({ kind: "device" });
      setSpace(null);
      setDoc(emptyDocument());
    },
    async connect(account: User) {
      remember(lastAccountKey, JSON.stringify(account));
      remember(spaceKey, "account");
      await open({ kind: "account", userId: account.id }, account);
    },
    async signOut() {
      if (
        (await syncState()).dirty &&
        !window.confirm(
          "Some changes haven’t synced yet. They will stay on this device for this account. Sign out anyway?",
        )
      )
        return;
      await signOutRemote();
      remember(lastAccountKey);
      remember(spaceKey);
      selectSpace({ kind: "device" });
      setUser(null);
      setSpace(null);
      setDoc(emptyDocument());
    },
    async deleteAccount(password: string) {
      if (!user) return;
      await deleteRemoteAccount(password);
      await Dexie.delete(
        databaseName({ kind: "account", userId: user.id }),
      ).catch(() => undefined);
      remember(lastAccountKey);
      remember(spaceKey);
      selectSpace({ kind: "device" });
      setUser(null);
      setSpace(null);
      setDoc(emptyDocument());
    },
    async saveNote(note: Note) {
      const saved = await saveLocalNote(note);
      await changed();
      return saved;
    },
    async removeNote(id: string) {
      await removeLocalNote(id);
      await changed();
    },
    async setPrefs(prefs: Prefs) {
      await savePrefs(prefs);
      await changed();
    },
    async importDocument(next: AppDocument) {
      await importBackup(next);
      await changed();
    },
    async eraseAll() {
      if (space?.kind === "account") {
        await eraseCloud();
        await deleteAll();
        await syncNow();
        await refresh();
        return;
      }
      await deleteAll();
      remember(spaceKey);
      setSpace(null);
      setDoc(emptyDocument());
    },
    syncNow,
    async resolveConflict(choice: "device" | "cloud") {
      const conflict = sync.conflict;
      if (!conflict) return;
      if (choice === "cloud") await applyCloud(conflict.remote);
      else await keepThisDevice(conflict.remote.revision);
      await syncNow();
      await refresh();
    },
  };
}
export type AppState = ReturnType<typeof useAppState>;
