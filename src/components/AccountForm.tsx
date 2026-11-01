import { useNavigate } from "react-router-dom";
import { EmailPasswordReset, RecoveryEmailSettings } from "../EmailRecovery";
import { useState } from "react";
import { authenticate, type User } from "../account-api";
import { config } from "../config";

type Mode = "register" | "login" | "recover";
const tabs: Record<Mode, string> = {
  register: "New account",
  login: "I have an account",
  recover: "Forgot password",
};
const submits: Record<Mode, string> = {
  register: "Create my account",
  login: "Sign in",
  recover: "Reset password",
};

/** Username/password accounts with a one-time recovery code (no email needed). */
export default function AccountForm({
  connect,
  offline = false,
}: {
  connect: (user: User) => Promise<void>;
  offline?: boolean;
}) {
  const navigate = useNavigate();
  const [emailRecovery, setEmailRecovery] = useState(true);
  async function finish(user: User) {
    setBusy(true);
    setError("");
    try {
      await connect(user);
      navigate("/", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const [mode, setMode] = useState<Mode>("register");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState<{ code: string; user: User }>();

  if (mode === "recover" && emailRecovery && !recovery)
    return (
      <section>
        <EmailPasswordReset />
        <div className="button-row">
          <button className="secondary" onClick={() => setEmailRecovery(false)}>
            Use my saved recovery code
          </button>
          <button className="secondary" onClick={() => setMode("login")}>
            Back to sign in
          </button>
        </div>
      </section>
    );
  if (recovery)
    return (
      <section className="recovery" aria-labelledby="recovery-title">
        <h2 id="recovery-title">Save your recovery code</h2>
        <p>
          Keep this backup code somewhere safe. You can also add a verified
          recovery email below or later in Settings. {config.name} can’t show
          this code again.
        </p>
        <output className="code" aria-label="Recovery code">
          {recovery.code}
        </output>
        <div className="button-row">
          <button
            type="button"
            className="secondary"
            onClick={() => void navigator.clipboard?.writeText(recovery.code)}
          >
            Copy code
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void finish(recovery.user)}
          >
            I’ve saved my recovery code — continue
          </button>
        </div>
        <RecoveryEmailSettings />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    );

  return (
    <form
      className="account-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          const result = await authenticate(
            mode,
            username,
            password,
            mode === "recover" ? code.trim() : undefined,
          );
          setPassword("");
          setCode("");
          if (result.recoveryCode)
            setRecovery({ code: result.recoveryCode, user: result.user });
          else await finish(result.user);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Something went wrong.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="segmented" role="group" aria-label="Account action">
        {(["register", "login", "recover"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m);
              setError("");
            }}
          >
            {tabs[m]}
          </button>
        ))}
      </div>
      <label>
        Username
        <input
          required
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          pattern="[A-Za-z0-9_]{3,40}"
          title="3–40 letters, numbers or underscores"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </label>
      {mode === "recover" && (
        <label>
          Recovery code
          <input
            required
            autoComplete="one-time-code"
            autoCapitalize="none"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
      )}
      <label>
        {mode === "recover" ? "New password" : "Password"}
        <input
          required
          type="password"
          minLength={12}
          maxLength={128}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby={mode !== "login" ? "password-hint" : undefined}
        />
      </label>
      {mode !== "login" && (
        <p id="password-hint" className="muted small hint">
          At least 12 characters.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="primary" disabled={busy || offline}>
        {busy ? "Please wait…" : submits[mode]}
      </button>
      {offline && <p className="muted">Connect to the internet to continue.</p>}
    </form>
  );
}
