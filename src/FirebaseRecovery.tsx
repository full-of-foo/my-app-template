import { useState } from "react";
import { api } from "./account-api";
export type FirebaseEmailState = { email: string | null; state: string | null };
export function FirebaseRecoverySettings({
  initial,
}: {
  initial: FirebaseEmailState;
}) {
  const [state, setState] = useState(initial);
  const [email, setEmail] = useState(initial.email ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
      try {
        const latest = await api<FirebaseEmailState>("/account/email?protocol=firebase");
        setState(latest);
        setEmail(latest.email ?? "");
      } catch {
        /* Keep the original error when offline. */
      }
    } finally {
      setBusy(false);
      setPassword("");
    }
  }
  return (
    <section className="panel" aria-label="Recovery email">
      <h2>Recovery email</h2>
      {state.state === "active" ? (
        <>
          <p>Verified email: {state.email}</p>
          <p>
            Your account now uses email password recovery. Keep signing in with
            your username and current password. Your previous recovery code no
            longer works.
          </p>
        </>
      ) : (
        <>
          <p>
            Add a verified email to recover a forgotten password. Your username
            and saved records stay the same. Google Firebase handles sign-in and
            recovery after setup.
          </p>
          <p>
            Until you finish setup, keep your saved recovery code. Finishing
            setup replaces that code with email recovery and signs out your
            other devices.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const result = await api<{ message: string }>(
                  "/account/email",
                  "POST",
                  { email, password },
                );
                setState({ email, state: "pending" });
                setMessage(result.message);
              });
            }}
          >
            <label>
              Recovery email address
              <input
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={state.state === "pending"}
              />
            </label>
            <label>
              Current password
              <input
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <div className="button-row">
              <button className="secondary" disabled={busy}>
                Send verification email
              </button>
              {state.state === "pending" && (
                <>
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || !password}
                    onClick={() =>
                      void run(async () => {
                        const result = await api<{
                          email: string;
                          state: string;
                        }>("/account/email/verify", "POST", { password });
                        setState(result);
                        // Finishing setup replaces this device's session; resume sync with it.
                        window.dispatchEvent(new Event("account:session-renewed"));
                        setMessage(
                          "Email recovery is ready. Your records are unchanged.",
                        );
                      })
                    }
                  >
                    I verified my email — finish setup
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy || !password}
                    onClick={() =>
                      void run(async () => {
                        await api("/account/email", "DELETE", { password });
                        setState({ email: null, state: null });
                        setMessage(
                          "Email setup cancelled. Your saved recovery code still works.",
                        );
                      })
                    }
                  >
                    Cancel email setup
                  </button>
                </>
              )}
            </div>
          </form>
          {state.state === "pending" && (
            <p>
              Open the link in your verification email, then enter your current
              password and finish setup here. If your email or password was
              changed before setup finished, cancel setup and start again.
            </p>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
