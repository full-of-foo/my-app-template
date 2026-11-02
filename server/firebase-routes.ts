import type { Express, Request, Response, NextFunction } from "express";
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { digest, token, verifyPassword } from "./security";
import { FirebaseAuthError, type FirebaseAuth } from "./firebase-auth";

/** Email accounts: Firebase Authentication owns the password; the app keeps IDs and records. */
export class FirebaseSetupError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

type Guard = (req: Request, res: Response, next: NextFunction) => Promise<void>;
const emailSchema = z.email().trim().toLowerCase().max(254);
const newPasswordSchema = z
  .string()
  .min(12, "Use at least 12 characters for your password.")
  .max(128);
const passwordSchema = z.string().min(1).max(128);
const usernameSchema = z.string().trim().toLowerCase().max(40);
const missingUser = (e: unknown) =>
  (e as { code?: string }).code === "auth/user-not-found";
const emailTaken = (e: unknown) =>
  (e as { code?: string }).code === "auth/email-already-exists";
const emailInUse = () =>
  new FirebaseSetupError(
    "An account already uses this email. Sign in, or reset your password.",
    409,
  );

export type FirebaseAccount = {
  id: string;
  username: string | null;
  password_hash: string;
  firebase_uid: string | null;
  firebase_state: "pending" | "active" | "deleting" | null;
  firebase_email: string | null;
  firebase_valid_after?: string | null;
};

/** The identity returned to clients. Email accounts have no username. */
export function publicUser(row: FirebaseAccount) {
  return {
    id: row.id,
    username: row.username,
    email: row.firebase_state === "active" ? row.firebase_email : null,
  };
}

const isEmailAccount = (row: Pick<FirebaseAccount, "firebase_state">) =>
  row.firebase_state === "active" || row.firebase_state === "deleting";

/** Sessions end after a Firebase password reset, revocation or identity deletion. */
export async function firebaseSessionValid(
  account: FirebaseAccount,
  firebase: FirebaseAuth | undefined,
  deleting = false,
) {
  if (!isEmailAccount(account)) return true;
  if (!firebase || !account.firebase_uid) return false;
  if (account.firebase_state === "deleting") return deleting;
  try {
    const user = await firebase.getUser(account.firebase_uid);
    return (
      !user.disabled &&
      (account.firebase_valid_after ?? "") === (user.tokensValidAfterTime ?? "")
    );
  } catch (error) {
    if (missingUser(error)) return false;
    throw error;
  }
}

export function installFirebaseRoutes(
  app: Express,
  pool: Pool,
  options: {
    firebase?: FirebaseAuth;
    required: Guard;
    session: (id: string, connection?: Pick<Pool, "query">) => Promise<string>;
    /** Creates the app's empty synced document for a new account. */
    createDocument: (client: PoolClient, userId: string) => Promise<void>;
    setCookie: (res: Response, value: string) => void;
    clearCookie: (res: Response) => void;
    readCookie: (req: Request) => string | undefined;
  },
) {
  const { firebase, required } = options;
  const provider = () => {
    if (!firebase) throw new FirebaseAuthError("unavailable");
    return firebase;
  };
  const account = async (
    id: string,
    client: Pick<Pool, "query"> = pool,
    lock = false,
  ) =>
    (
      await client.query<FirebaseAccount>(
        `SELECT * FROM users WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
        [id],
      )
    ).rows[0];
  async function transaction<T>(action: (client: PoolClient) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await action(client);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async function session(id: string, validAfter: string, client: PoolClient) {
    const raw = await options.session(id, client);
    await client.query(
      "UPDATE sessions SET firebase_valid_after=$1 WHERE token_hash=$2",
      [validAfter, digest(raw)],
    );
    return raw;
  }
  /** Verification mail is best-effort: the account works while unverified. */
  async function sendVerification(id: string, uid: string) {
    const allowed = await pool.query(
      "UPDATE users SET firebase_last_mail_at=now() WHERE id=$1 AND (firebase_last_mail_at IS NULL OR firebase_last_mail_at<now()-interval '1 minute') RETURNING id",
      [id],
    );
    if (!allowed.rowCount) return false;
    await provider()
      .sendVerification(uid)
      .catch(() => console.error("Verification email could not be sent."));
    return true;
  }
  async function signInEmailAccount(
    row: FirebaseAccount,
    password: string,
    req: Request,
    res: Response,
  ) {
    const auth = provider();
    if (row.firebase_state !== "active")
      throw new FirebaseSetupError("Account deletion is in progress.", 409);
    const verified = await auth.signIn(row.firebase_email!, password);
    if (verified.uid !== row.firebase_uid)
      throw new FirebaseAuthError("credentials");
    const remote = await auth.getUser(row.firebase_uid);
    if (remote.disabled) throw new FirebaseAuthError("credentials");
    const old = options.readCookie(req);
    const raw = await transaction(async (client) => {
      const current = await account(row.id, client, true);
      if (current?.firebase_state !== "active")
        throw new FirebaseAuthError("credentials");
      if (old)
        await client.query("DELETE FROM sessions WHERE token_hash=$1", [
          digest(old),
        ]);
      return session(row.id, remote.tokensValidAfterTime ?? "", client);
    });
    options.setCookie(res, raw);
    res.json({ user: publicUser(row) });
  }

  app.get("/api/auth/email-capability", (req, res, next) => {
    // Installed app versions that predate email accounts never send the protocol flag.
    if (req.query.protocol !== "firebase") {
      if (firebase) res.json({ available: false });
      else next();
      return;
    }
    res.json(
      firebase
        ? { available: true, provider: "firebase", accounts: "email" }
        : { available: false },
    );
  });

  app.post("/api/auth/register", async (req, res, next) => {
    if (typeof req.body?.email !== "string") {
      next(); // Username registration from older installed versions.
      return;
    }
    const auth = provider();
    const { email, password } = z
      .object({ email: emailSchema, password: newPasswordSchema })
      .strict()
      .parse(req.body);
    const existing = await pool.query(
      "SELECT 1 FROM users WHERE firebase_email=$1",
      [email],
    );
    if (existing.rowCount) throw emailInUse();
    const id = randomUUID();
    try {
      await auth.createUser(id, email, password);
    } catch (e) {
      if (emailTaken(e)) throw emailInUse();
      throw new FirebaseAuthError("unavailable");
    }
    let raw = "";
    try {
      const remote = await auth.getUser(id);
      raw = await transaction(async (client) => {
        await client.query(
          "INSERT INTO users(id,username,password_hash,recovery_hash,firebase_uid,firebase_state,firebase_email) VALUES($1,NULL,'firebase',$2,$4,'active',$3)",
          [id, digest(token()), email, id],
        );
        await options.createDocument(client, id);
        return session(id, remote.tokensValidAfterTime ?? "", client);
      });
    } catch (e) {
      await auth.deleteUser(id).catch(() => undefined);
      if ((e as { code?: string }).code === "23505") throw emailInUse();
      throw e;
    }
    options.setCookie(res, raw);
    await sendVerification(id, id);
    res.status(201).json({ user: { id, username: null, email } });
  });

  app.post("/api/auth/login", async (req, res, next) => {
    if (typeof req.body?.email === "string") {
      const { email, password } = z
        .object({ email: emailSchema, password: passwordSchema })
        .strict()
        .parse(req.body);
      provider();
      const row = (
        await pool.query<FirebaseAccount>(
          "SELECT * FROM users WHERE firebase_email=$1 AND firebase_state IN ('active','deleting')",
          [email],
        )
      ).rows[0];
      if (!row) throw new FirebaseAuthError("credentials");
      await signInEmailAccount(row, password, req, res);
      return;
    }
    // Username sign-in remains for accounts that haven't added an email yet.
    const username = usernameSchema.parse(req.body?.username);
    const row = (
      await pool.query<FirebaseAccount>(
        "SELECT * FROM users WHERE username=$1",
        [username],
      )
    ).rows[0];
    if (!row || !isEmailAccount(row)) {
      next();
      return;
    }
    await signInEmailAccount(
      row,
      passwordSchema.parse(req.body?.password),
      req,
      res,
    );
  });

  app.post("/api/auth/recover", async (req, res, next) => {
    const username = usernameSchema.parse(req.body?.username);
    const row = (
      await pool.query<FirebaseAccount>(
        "SELECT * FROM users WHERE username=$1",
        [username],
      )
    ).rows[0];
    if (!row || !isEmailAccount(row)) {
      next();
      return;
    }
    res.status(400).json({
      error:
        "This account signs in with email. Use “Forgot password” to get a reset email.",
    });
  });

  app.delete("/api/account", required, async (req, res, next) => {
    const row = await account(res.locals.user.id);
    if (!isEmailAccount(row)) {
      next();
      return;
    }
    const auth = provider();
    const password = passwordSchema.parse(req.body?.password);
    if (row.firebase_state === "active") {
      const verified = await auth.signIn(row.firebase_email!, password);
      if (verified.uid !== row.firebase_uid)
        throw new FirebaseAuthError("credentials");
      await pool.query(
        "UPDATE users SET firebase_state='deleting' WHERE id=$1",
        [row.id],
      );
    }
    // A deletion-only session can retry if either service temporarily fails.
    try {
      await auth.deleteUser(row.firebase_uid!);
    } catch (e) {
      if (!missingUser(e)) throw e;
    }
    await pool.query("DELETE FROM users WHERE id=$1", [row.id]);
    options.clearCookie(res);
    res.status(204).end();
  });

  // Older installed versions used these for the custom recovery-email flow.
  app.use("/api/account/email", required, async (req, res, next) => {
    if (req.query.protocol === "firebase" || req.path !== "/") {
      next();
      return;
    }
    if (!firebase) {
      const row = await account(res.locals.user.id);
      if (isEmailAccount(row)) throw new FirebaseAuthError("unavailable");
      next();
      return;
    }
    if (req.method === "GET") res.json({ available: false, email: null });
    else
      res.status(400).json({
        error: "Update the app to add an email to your account.",
      });
  });
  if (!firebase) return;

  app.get("/api/account/email", required, async (_req, res) => {
    const row = await account(res.locals.user.id);
    let emailVerified = false;
    if (row.firebase_state === "active" && row.firebase_uid) {
      try {
        emailVerified = (await firebase.getUser(row.firebase_uid))
          .emailVerified;
      } catch (error) {
        if (!missingUser(error)) throw error;
      }
    }
    res.json({
      available: true,
      provider: "firebase",
      state: isEmailAccount(row) ? row.firebase_state : null,
      email: isEmailAccount(row) ? row.firebase_email : null,
      emailVerified,
    });
  });

  /** One-time upgrade: a username account adds an email and keeps its password and records. */
  app.post("/api/account/email", required, async (req, res) => {
    const { email, password } = z
      .object({ email: emailSchema, password: passwordSchema })
      .strict()
      .parse(req.body);
    const row = await account(res.locals.user.id);
    if (isEmailAccount(row))
      throw new FirebaseSetupError("This account already uses email sign-in.");
    if (!(await verifyPassword(password, row.password_hash)))
      throw new FirebaseAuthError("credentials");
    if (password.length < 12)
      throw new FirebaseSetupError("Use at least 12 characters for your password.");
    const taken = await pool.query(
      "SELECT 1 FROM users WHERE firebase_email=$1 AND id<>$2",
      [email, row.id],
    );
    if (taken.rowCount) throw emailInUse();
    // A Firebase identity left by an interrupted attempt is not yet authoritative.
    await firebase.deleteUser(row.id).catch((e) => {
      if (!missingUser(e)) throw e;
    });
    try {
      await firebase.createUser(row.id, email, password);
    } catch (e) {
      if (emailTaken(e)) throw emailInUse();
      throw new FirebaseAuthError("unavailable");
    }
    let raw = "";
    try {
      const remote = await firebase.getUser(row.id);
      raw = await transaction(async (client) => {
        const current = await account(row.id, client, true);
        if (!current || isEmailAccount(current))
          throw new FirebaseSetupError("This account already uses email sign-in.");
        await client.query(
          "UPDATE users SET firebase_uid=$4,firebase_state='active',firebase_email=$2,firebase_last_mail_at=NULL,recovery_email=NULL,password_hash='firebase',recovery_hash=$3 WHERE id=$1",
          [row.id, email, digest(token()), row.id],
        );
        await client.query("DELETE FROM email_challenges WHERE user_id=$1", [
          row.id,
        ]);
        // The old password and recovery code are retired: sign out other devices.
        await client.query("DELETE FROM sessions WHERE user_id=$1", [row.id]);
        return session(row.id, remote.tokensValidAfterTime ?? "", client);
      });
    } catch (e) {
      await firebase.deleteUser(row.id).catch(() => undefined);
      if ((e as { code?: string }).code === "23505") throw emailInUse();
      throw e;
    }
    options.setCookie(res, raw);
    await sendVerification(row.id, row.id);
    res.json({ user: { id: row.id, username: row.username, email } });
  });

  app.post("/api/account/email/verification", required, async (_req, res) => {
    const row = await account(res.locals.user.id);
    if (row.firebase_state !== "active" || !row.firebase_uid)
      throw new FirebaseSetupError("Add an email to your account first.");
    if (!(await sendVerification(row.id, row.firebase_uid))) {
      res.status(429).json({
        error: "Please wait a minute before requesting another email.",
      });
      return;
    }
    res.json({ message: "Verification email sent. Check your inbox." });
  });

  app.post("/api/auth/email/request", async (req, res) => {
    const { email } = z
      .object({ email: emailSchema, username: z.string().max(40).optional() })
      .strict()
      .parse(req.body);
    const result = await pool.query<FirebaseAccount>(
      "UPDATE users SET firebase_reset_at=now() WHERE firebase_email=$1 AND firebase_state='active' AND (firebase_reset_at IS NULL OR firebase_reset_at<now()-interval '1 minute') RETURNING *",
      [email],
    );
    res.json({
      message:
        "If an account uses this email, a password-reset link is on its way. Open it, choose a new password, then sign in here.",
    });
    if (result.rows[0])
      void firebase
        .sendPasswordReset(email)
        .catch(() => console.error("Password-reset delivery could not complete."));
  });
  app.post("/api/auth/email/reset", (_req, res) =>
    res.status(400).json({
      error:
        "Open the password-reset link in your email to choose a new password, then sign in.",
    }),
  );
}
