import { useEffect, useState, type ReactNode } from "react";
import {
  api,
  authenticate,
  emailAuthenticate,
  type User,
} from "./account-api";

// Shared by herPal, Quitwell and My App Template: keep the copies identical.

/** True when the server offers email accounts (Firebase), false for username accounts. */
export function useEmailAccounts() {
  const [available, setAvailable] = useState<boolean>();
  useEffect(() => {
    let active = true;
    void api<{ available: boolean; accounts?: string }>(
      "/auth/email-capability?protocol=firebase",
    )
      .then((s) => active && setAvailable(s.available && s.accounts === "email"))
      .catch(() => active && setAvailable(false));
    return () => {
      active = false;
    };
  }, []);
  return available;
}

const sessionRenewed = () =>
  window.dispatchEvent(new Event("account:session-renewed"));

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function run(action: () => Promise<string | void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setMessage((await action()) ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const feedback = (
    <>
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
  return { busy, run, feedback };
}

function EmailField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      Email
      <input
        required
        type="email"
        aria-label="Email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={254}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function PasswordField({
  value,
  onChange,
  label = "Password",
  fresh = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  fresh?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        required
        type="password"
        aria-label={label}
        minLength={fresh ? 12 : undefined}
        maxLength={128}
        autoComplete={fresh ? "new-password" : "current-password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {fresh && <small>At least 12 characters. Use a unique password.</small>}
    </label>
  );
}

type Mode = "register" | "login" | "reset" | "username" | "code";
const tabs: { mode: Mode; label: string }[] = [
  { mode: "register", label: "Create account" },
  { mode: "login", label: "Sign in" },
  { mode: "reset", label: "Forgot password" },
];

/** Sign up, sign in and password reset with email. */
export function EmailSignIn({
  connect,
  offline = false,
  consent,
  initialMode = "register",
}: {
  connect: (user: User) => Promise<void>;
  offline?: boolean;
  consent?: ReactNode;
  initialMode?: "register" | "login";
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const { busy, run, feedback } = useAction();
  const go = (next: Mode) => {
    setMode(next);
    setPassword("");
  };
  const submit = () =>
    run(async () => {
      if (mode === "reset") {
        const r = await api<{ message: string }>("/auth/email/request", "POST", {
          email,
        });
        return r.message;
      }
      const result =
        mode === "username"
          ? await authenticate("login", username, password)
          : mode === "code"
            ? await authenticate("recover", username, password, code.trim())
            : await emailAuthenticate(mode, email, password);
      setPassword("");
      await connect(result.user);
    });
  const legacy = mode === "username" || mode === "code";
  return (
    <div className="email-sign-in">
      {!legacy && (
        <div className="button-row" role="group" aria-label="Account action">
          {tabs.map((t) => (
            <button
              key={t.mode}
              type="button"
              className={mode === t.mode ? "primary" : "secondary"}
              aria-pressed={mode === t.mode}
              onClick={() => go(t.mode)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <form
        aria-label={
          mode === "register"
            ? "Create account"
            : mode === "reset"
              ? "Reset password"
              : "Sign in"
        }
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {legacy ? (
          <>
            <p>
              {mode === "username"
                ? "Signed up with a username before email accounts? Sign in once with it, then add your email."
                : "Use the recovery code you saved when you created your account."}
            </p>
            <label>
              Username
              <input
                required
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={40}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            {mode === "code" && (
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
            <PasswordField
              value={password}
              onChange={setPassword}
              label={mode === "code" ? "New password" : "Password"}
              fresh={mode === "code"}
            />
          </>
        ) : (
          <>
            <EmailField value={email} onChange={setEmail} />
            {mode === "reset" ? (
              <p>
                We’ll email you a link to choose a new password. Open it, then
                come back and sign in.
              </p>
            ) : (
              <PasswordField
                value={password}
                onChange={setPassword}
                fresh={mode === "register"}
              />
            )}
          </>
        )}
        {mode === "register" && consent}
        <button className="primary" disabled={busy || offline}>
          {busy
            ? "Please wait…"
            : mode === "register"
              ? "Create my account"
              : mode === "reset"
                ? "Send reset email"
                : mode === "code"
                  ? "Reset password"
                  : "Sign in to my account"}
        </button>
        {offline && <p>Connect to the internet to continue.</p>}
      </form>
      {feedback}
      <p className="small">
        {legacy ? (
          <>
            {mode === "username" && (
              <button
                type="button"
                className="text-button"
                onClick={() => go("code")}
              >
                Forgot it? Use your recovery code
              </button>
            )}
            <button
              type="button"
              className="text-button"
              onClick={() => go("login")}
            >
              Back to email sign-in
            </button>
          </>
        ) : (
          <button
            type="button"
            className="text-button"
            onClick={() => go("username")}
          >
            Signed up with a username?
          </button>
        )}
      </p>
    </div>
  );
}

/** Signed-in account email: required for older username accounts, plus verification status. */
export function EmailAccountSettings({
  user,
  updateAccount,
}: {
  user: User;
  /** Stores the account's new identity without switching accounts. */
  updateAccount: (user: User) => Promise<void> | void;
}) {
  const [verified, setVerified] = useState<boolean>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, run, feedback } = useAction();
  useEffect(() => {
    if (!user.email) return;
    let active = true;
    void api<{ emailVerified?: boolean }>("/account/email?protocol=firebase")
      .then((s) => active && setVerified(!!s.emailVerified))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [user.email]);
  if (!user.email)
    return (
      <section className="panel email-upgrade" aria-label="Add your email">
        <h2>Add your email to keep signing in</h2>
        <p>
          Accounts now sign in with an email address, and it’s how you reset a
          forgotten password. Your password and records stay the same. Adding
          it signs out your other devices and retires your recovery code.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const result = await api<{ user: User }>(
                "/account/email?protocol=firebase",
                "POST",
                { email, password },
              );
              setPassword("");
              await updateAccount(result.user);
              sessionRenewed();
              return "Email added. Sign in with it from now on. We’ve sent a link to verify it.";
            });
          }}
        >
          <EmailField value={email} onChange={setEmail} />
          <PasswordField
            value={password}
            onChange={setPassword}
            label="Current password"
          />
          <button className="primary" disabled={busy}>
            Add email
          </button>
        </form>
        {feedback}
      </section>
    );
  return (
    <section className="panel" aria-label="Account email">
      <h2>Account email</h2>
      <p>
        You sign in with <strong>{user.email}</strong>.{" "}
        {verified === false
          ? "Please verify it with the link we emailed you."
          : verified
            ? "Verified."
            : ""}
      </p>
      {verified === false && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const r = await api<{ message: string }>(
                "/account/email/verification?protocol=firebase",
                "POST",
                {},
              );
              return r.message;
            })
          }
        >
          Resend verification email
        </button>
      )}
      {feedback}
    </section>
  );
}

/** Password prompt when a signed-in device's session has ended. */
export async function signInAgain(user: User, password: string) {
  return user.email
    ? emailAuthenticate("login", user.email, password)
    : authenticate("login", user.username ?? "", password);
}
