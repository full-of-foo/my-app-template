import { useEffect, useState } from "react";
import { api } from "./account-api";

/** Uses the same API transport in the browser and installed apps. */
export function RecoveryEmailSettings() {
  const [state, setState] = useState<{
    available: boolean;
    email: string | null;
    provider?: string;
    state?: string | null;
  }>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api<{ available: boolean; email: string | null }>("/account/email?protocol=firebase")
      .then((s) => {
        if (active) setState(s);
      })
      .catch(() => {
        if (active)
          setError(
            "Recovery email settings are unavailable. Your saved recovery code still works.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-label="Recovery email">
      <h2>Recovery email</h2>
      <p>
        Add and verify an email so you can reset a forgotten password. We use it
        only for account recovery.
      </p>
      {state && (
        <p>
          {state.email
            ? `Verified email: ${state.email}`
            : "No verified recovery email yet."}
        </p>
      )}
      {state && !state.available && (
        <p>
          Email recovery isn’t available yet. Keep your saved recovery code
          safe.
        </p>
      )}
      {state?.available && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api("/account/email", "POST", { email, password });
                setPassword("");
                setSent(true);
                setMessage(
                  "Check your email for a verification code. It expires in 15 minutes.",
                );
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
              {state.email && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || !password}
                  onClick={() =>
                    void run(async () => {
                      await api("/account/email", "DELETE", { password });
                      setState({ ...state, email: null });
                      setPassword("");
                      setSent(false);
                      setMessage("Recovery email removed.");
                    })
                  }
                >
                  Remove recovery email
                </button>
              )}
            </div>
          </form>
          {sent && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const result = await api<{ email: string }>(
                    "/account/email/verify",
                    "POST",
                    { code: code.trim() },
                  );
                  setState({ ...state, email: result.email });
                  setCode("");
                  setSent(false);
                  setMessage(
                    "Email verified. You can now use it to recover your account.",
                  );
                });
              }}
            >
              <label>
                Email verification code
                <input
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
              <button className="primary" disabled={busy}>
                Verify email
              </button>
            </form>
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
export function EmailPasswordReset() {
  const [available, setAvailable] = useState<boolean>();
  const [provider, setProvider] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState("");
  useEffect(() => {
    let active = true;
    void api<{ available: boolean; provider?: string }>(
      "/auth/email-capability?protocol=firebase",
    )
      .then((s) => {
        if (active) {
          setAvailable(s.available);
          setProvider(s.provider ?? "");
        }
      })
      .catch(() => {
        if (active)
          setError(
            "Email recovery is unavailable right now. Try your saved recovery code.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Email password recovery">
      <h2>Reset your password by email</h2>
      <p>Use the username and email you verified in Recovery email settings.</p>
      {available === false && (
        <p>
          Email recovery isn’t available yet. Use your saved recovery code
          below.
        </p>
      )}
      {available && !recovery && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const result = await api<{ message: string }>(
                  "/auth/email/request",
                  "POST",
                  { username, email },
                );
                setMessage(result.message);
                setSent(true);
              });
            }}
          >
            <label>
              Username
              <input
                required
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setSent(false);
                  setCode("");
                }}
              />
            </label>
            <label>
              Verified email address
              <input
                required
                type="email"
                autoComplete="email"
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy}>
              Send reset email
            </button>
          </form>
          {provider !== "firebase" && (
            <button
              type="button"
              className="text"
              onClick={() => setSent(true)}
            >
              I already have an email reset code
            </button>
          )}
          {sent && provider !== "firebase" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const result = await api<{
                    message: string;
                    recoveryCode: string;
                  }>("/auth/email/reset", "POST", {
                    username,
                    code: code.trim(),
                    password,
                  });
                  setMessage(result.message);
                  setRecovery(result.recoveryCode);
                  setPassword("");
                  setCode("");
                });
              }}
            >
              <label>
                Email reset code
                <input
                  required
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
              <label>
                New password
                <input
                  required
                  type="password"
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button className="primary" disabled={busy}>
                Update password
              </button>
            </form>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
      {recovery && (
        <>
          <h3>Save your new recovery code</h3>
          <p>
            Your previous recovery code no longer works. All devices have been
            signed out.
          </p>
          <output className="code" aria-label="Recovery code">
            {recovery}
          </output>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
