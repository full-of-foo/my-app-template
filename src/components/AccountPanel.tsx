import { RecoveryEmailSettings } from "../EmailRecovery";
import { useState } from "react";
import { Cloud, RefreshCw } from "lucide-react";
import { config } from "../config";
import { authenticate } from "../account-api";
import AccountForm from "./AccountForm";
import type { AppState } from "../useAppState";

/** Settings → Account & sync. The only place routine sync status appears. */
export default function AccountPanel({ app }: { app: AppState }) {
  const { user, sync, offline, space } = app;
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await task();
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel" aria-labelledby="account-title">
      <h2 id="account-title">
        <Cloud size={20} aria-hidden /> Account & sync
      </h2>
      {space?.kind === "demo" ? (
        <p>Leave the sample to create or sign in to your account.</p>
      ) : !user ? (
        <>
          <p>
            Your records are saved only on this device. Create an account or
            sign in to use them on your other devices. To move records into an
            account, export a backup below and import it after signing in.
          </p>
          <AccountForm connect={app.connect} offline={offline} />
        </>
      ) : (
        <>
          <p>
            <strong>Signed in as {user.username}</strong>
            <br />
            <span role="status">
              {offline
                ? "You’re offline. Your records stay available; sync resumes when you reconnect."
                : sync.status}
            </span>
          </p>
          <p className="muted">
            Last successful sync:{" "}
            {sync.lastSyncedAt
              ? new Date(sync.lastSyncedAt).toLocaleString()
              : "Not yet on this device"}
            . Changes sync automatically while you use {config.name} and when
            you reopen it with a connection.
          </p>
          {sync.needsSignIn && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const result = await authenticate(
                    "login",
                    user.username,
                    password,
                  );
                  await app.connect(result.user);
                });
              }}
            >
              <label>
                Account password
                <input
                  required
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button className="primary" disabled={busy || offline}>
                Sign in again
              </button>
            </form>
          )}
          <div className="button-row">
            <button
              className="secondary"
              disabled={
                busy ||
                offline ||
                sync.needsSignIn ||
                sync.status === "Syncing…"
              }
              onClick={() => void app.syncNow()}
            >
              <RefreshCw size={16} aria-hidden /> Sync now
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void run(app.signOut)}
            >
              Sign out
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() => setDeleting(true)}
            >
              Delete account
            </button>
          </div>
          {deleting && (
            <form
              className="inset"
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  !window.confirm(
                    "Permanently delete your account and its synced records? Backups you downloaded are not affected.",
                  )
                )
                  return;
                void run(() => app.deleteAccount(password));
              }}
            >
              <h3>Delete account</h3>
              <p>
                This permanently removes your account, its synced records and
                its sign-in sessions. It cannot be undone.
              </p>
              <label>
                Confirm with your password
                <input
                  required
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <div className="button-row">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setDeleting(false)}
                >
                  Cancel
                </button>
                <button className="danger" disabled={busy}>
                  Delete my account
                </button>
              </div>
            </form>
          )}
        </>
      )}
      {user && <RecoveryEmailSettings key={user.id} />}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
