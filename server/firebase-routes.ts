import type { Express, Request, Response, NextFunction } from "express";
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { digest, token, verifyPassword } from "./security";
import { FirebaseAuthError, type FirebaseAuth } from "./firebase-auth";

export class FirebaseSetupError extends Error {}

type Guard = (req: Request, res: Response, next: NextFunction) => Promise<void>;
const inputSchema = z
  .object({
    email: z.email().trim().toLowerCase().max(254),
    password: z.string().min(1).max(128),
  })
  .strict();
const passwordSchema = z
  .object({ password: z.string().min(1).max(128) })
  .strict();
const missingUser = (e: unknown) =>
  (e as { code?: string }).code === "auth/user-not-found";
export type FirebaseAccount = {
  id: string;
  username: string;
  password_hash: string;
  firebase_uid: string | null;
  firebase_state: "pending" | "active" | "deleting" | null;
  firebase_email: string | null;
  firebase_valid_after?: string | null;
};

/** Existing cookies become invalid immediately after a Firebase reset or identity deletion. */
export async function firebaseSessionValid(
  account: FirebaseAccount,
  firebase: FirebaseAuth | undefined,
  deleting = false,
) {
  if (!account.firebase_state || account.firebase_state === "pending")
    return true;
  if (!firebase || !account.firebase_uid) return false;
  if (account.firebase_state === "deleting") return deleting;
  try {
    const user = await firebase.getUser(account.firebase_uid);
    return (
      !user.disabled &&
      user.emailVerified &&
      !!account.firebase_valid_after &&
      account.firebase_valid_after === user.tokensValidAfterTime
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
    limits?: boolean;
    session: (id: string, connection?: Pick<Pool, "query">) => Promise<string>;
    setCookie: (res: Response, value: string) => void;
    clearCookie: (res: Response) => void;
  },
) {
  const { firebase, required } = options;
  async function account(
    id: string,
    client: Pick<Pool, "query"> = pool,
    lock = false,
  ) {
    return (
      await client.query<FirebaseAccount>(
        `SELECT * FROM users WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
        [id],
      )
    ).rows[0];
  }
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
  // Guard even when the provider has been disabled: never fall back to stale passwords.
  app.post("/api/auth/login", async (req, res, next) => {
    const username = z
      .string()
      .trim()
      .toLowerCase()
      .max(40)
      .parse(req.body.username);
    const row = (
      await pool.query<FirebaseAccount>(
        "SELECT * FROM users WHERE username=$1",
        [username],
      )
    ).rows[0];
    if (!row?.firebase_state || row.firebase_state === "pending") {
      next();
      return;
    }
    if (!firebase) throw new FirebaseAuthError("unavailable");
    if (row.firebase_state !== "active") {
      res.status(409).json({ error: "Account deletion is in progress." });
      return;
    }
    const password = z.string().min(1).max(128).parse(req.body.password);
    const remote = await firebase.getUser(row.firebase_uid!);
    if (!remote.email || !remote.emailVerified || remote.disabled)
      throw new FirebaseAuthError("credentials");
    const verified = await firebase.signIn(remote.email, password);
    if (verified.uid !== row.firebase_uid)
      throw new FirebaseAuthError("credentials");
    const raw = await transaction(async (client) => {
      const current = await account(row.id, client, true);
      if (current.firebase_state !== "active")
        throw new FirebaseAuthError("credentials");
      return session(row.id, remote.tokensValidAfterTime!, client);
    });
    options.setCookie(res, raw);
    res.json({ user: { id: row.id, username: row.username } });
  });
  app.post("/api/auth/recover", async (req, res, next) => {
    const username = z
      .string()
      .trim()
      .toLowerCase()
      .max(40)
      .parse(req.body.username);
    const row = (
      await pool.query<FirebaseAccount>(
        "SELECT * FROM users WHERE username=$1",
        [username],
      )
    ).rows[0];
    if (!row?.firebase_state || row.firebase_state === "pending") {
      next();
      return;
    }
    res.status(400).json({
      error:
        "This account uses email recovery. Request a password-reset email instead.",
    });
  });
  app.delete("/api/account", required, async (req, res, next) => {
    const row = await account(res.locals.user.id);
    if (!row.firebase_uid) {
      next();
      return;
    }
    if (!firebase) throw new FirebaseAuthError("unavailable");
    const { password } = passwordSchema.parse(req.body);
    if (row.firebase_state !== "deleting") {
      if (row.firebase_state === "active") {
        const remote = await firebase.getUser(row.firebase_uid);
        const verified = await firebase.signIn(remote.email!, password);
        if (verified.uid !== row.firebase_uid)
          throw new FirebaseAuthError("credentials");
      } else if (!(await verifyPassword(password, row.password_hash)))
        throw new FirebaseAuthError("credentials");
      await pool.query(
        "UPDATE users SET firebase_state='deleting' WHERE id=$1",
        [row.id],
      );
    }
    // A retained, deletion-only session can retry if either service temporarily fails.
    try {
      await firebase.deleteUser(row.firebase_uid);
    } catch (e) {
      if (!missingUser(e)) throw e;
    }
    await pool.query("DELETE FROM users WHERE id=$1", [row.id]);
    options.clearCookie(res);
    res.status(204).end();
  });
  // Never let a migrated user reach legacy recovery-email mutations.
  if (!firebase) {
    app.use("/api/account/email", required, async (_req, res, next) => {
      const row = await account(res.locals.user.id);
      if (row.firebase_state) throw new FirebaseAuthError("unavailable");
      next();
    });
    return;
  }
  if (options.limits !== false)
    app.use(
      "/api/account/email",
      rateLimit({
        windowMs: 3600000,
        limit: 15,
        skip: (req) => req.method === "GET",
        standardHeaders: "draft-8",
        legacyHeaders: false,
      }),
    );
  app.get("/api/auth/email-capability", (req, res) =>
    res.json(req.query.protocol === "firebase" ? { available: true, provider: "firebase" } : { available: false }),
  );
  app.get("/api/account/email", required, async (req, res) => {
    if (req.query.protocol !== "firebase") { res.json({available:false,email:null}); return; }
    const row = await account(res.locals.user.id);
    res.json({
      available: true,
      provider: "firebase",
      state: row.firebase_state,
      email: row.firebase_email,
    });
  });
  app.post("/api/account/email", required, async (req, res) => {
    const { email, password } = inputSchema.parse(req.body);
    // Persist a reserved UID before contacting Firebase, allowing safe retries after interruption.
    const row = await transaction(async (client) => {
      const current = await account(res.locals.user.id, client, true);
      if (
        current.firebase_state === "active" ||
        current.firebase_state === "deleting"
      ) {
        throw new FirebaseSetupError("Enrollment is already complete.");
      }
      if (!(await verifyPassword(password, current.password_hash)))
        throw new FirebaseAuthError("credentials");
      if (current.firebase_uid && current.firebase_email !== email)
        throw new FirebaseSetupError(
          "Cancel the pending email setup before choosing another address.",
        );
      if (!current.firebase_uid) {
        await client.query(
          "UPDATE users SET firebase_uid=$1,firebase_state='pending',firebase_email=$2 WHERE id=$3",
          [randomUUID(), email, current.id],
        );
      }
      return await account(current.id, client);
    });
    await transaction(async (client) => {
      const locked = await account(row.id, client, true);
      if (
        !locked ||
        locked.firebase_state !== "pending" ||
        locked.firebase_uid !== row.firebase_uid ||
        !(await verifyPassword(password, locked.password_hash))
      )
        throw new FirebaseAuthError("credentials");
      try {
        await firebase.getUser(row.firebase_uid!);
      } catch (error) {
        if (!missingUser(error)) throw error;
        await firebase.createUser(row.firebase_uid!, email, password);
      }
      const remote = await firebase.getUser(row.firebase_uid!);
      if (remote.email?.toLowerCase() !== email)
        throw new FirebaseAuthError("credentials");
      const signed = await firebase.passwordSession(email, password);
      if (signed.verified.uid !== row.firebase_uid)
        throw new FirebaseAuthError("credentials");
      const allowed = await client.query(
        "UPDATE users SET firebase_last_mail_at=now() WHERE id=$1 AND (firebase_last_mail_at IS NULL OR firebase_last_mail_at<now()-interval '1 minute') RETURNING id",
        [row.id],
      );
      if (!allowed.rowCount) {
        res.status(429).json({
          error:
            "Please wait a minute before requesting another verification email.",
        });
        return;
      }
      await firebase.sendVerification(signed.idToken);
    });
    if (res.headersSent) return;
    res.json({
      message:
        "Open the verification link in your email, then return here to finish setup.",
    });
  });
  app.post("/api/account/email/verify", required, async (req, res) => {
    const { password } = passwordSchema.parse(req.body);
    const result = await transaction(async (client) => {
      const row = await account(res.locals.user.id, client, true);
      if (row.firebase_state !== "pending" || !row.firebase_uid)
        throw new FirebaseAuthError("credentials");
      if (!(await verifyPassword(password, row.password_hash)))
        throw new FirebaseAuthError("credentials");
      const remote = await firebase.getUser(row.firebase_uid);
      if (
        !remote.emailVerified ||
        remote.email?.toLowerCase() !== row.firebase_email
      ) {
        return { unverified: true as const };
      }
      const verified = await firebase.signIn(remote.email!, password);
      if (verified.uid !== row.firebase_uid)
        throw new FirebaseAuthError("credentials");
      await client.query(
        "UPDATE users SET firebase_state='active',firebase_last_mail_at=NULL,recovery_email=$1,password_hash=$2,recovery_hash=$3 WHERE id=$4",
        [remote.email, "firebase", digest(token()), row.id],
      );
      await client.query("DELETE FROM email_challenges WHERE user_id=$1", [
        row.id,
      ]);
      await client.query("DELETE FROM sessions WHERE user_id=$1", [row.id]);
      const raw = await session(row.id, remote.tokensValidAfterTime!, client);
      return { raw, email: remote.email };
    });
    if ("unverified" in result) {
      res.status(400).json({
        error:
          "Open the verification link in your inbox before finishing setup.",
      });
      return;
    }
    options.setCookie(res, result.raw);
    res.json({ email: result.email, state: "active" });
  });
  app.delete("/api/account/email", required, async (req, res) => {
    const { password } = passwordSchema.parse(req.body);
    await transaction(async (client) => {
      const row = await account(res.locals.user.id, client, true);
      if (row.firebase_state === "active" || row.firebase_state === "deleting")
        throw new FirebaseSetupError(
          "Your verified email is needed for sign-in and recovery. It cannot be removed.",
        );
      if (!(await verifyPassword(password, row.password_hash)))
        throw new FirebaseAuthError("credentials");
      if (row.firebase_uid) {
        try {
          await firebase.deleteUser(row.firebase_uid);
        } catch (e) {
          if (!missingUser(e)) throw e;
        }
      }
      await client.query(
        "UPDATE users SET firebase_uid=NULL,firebase_state=NULL,firebase_email=NULL,firebase_last_mail_at=NULL WHERE id=$1",
        [row.id],
      );
    });
    res.status(204).end();
  });
  app.post("/api/auth/email/request", async (req, res) => {
    const { email, username } = z
      .object({
        email: z.email().trim().toLowerCase(),
        username: z.string().trim().toLowerCase().max(40),
      })
      .strict()
      .parse(req.body);
    const result = await pool.query<FirebaseAccount>(
      "UPDATE users SET firebase_last_mail_at=now() WHERE username=$1 AND firebase_email=$2 AND firebase_state='active' AND (firebase_last_mail_at IS NULL OR firebase_last_mail_at<now()-interval '20 minutes') RETURNING *",
      [username, email],
    );
    res.json({
      message:
        "If these details match an account with verified email recovery, a password-reset link will arrive shortly. Open it in your browser, then return to sign in.",
    });
    if (result.rows[0])
      void firebase
        .sendPasswordReset(email)
        .catch(() =>
          console.error("Password-reset delivery could not complete."),
        );
  });
  app.post("/api/auth/email/reset", (_req, res) =>
    res.status(400).json({
      error:
        "Open the password-reset link in your email to choose a new password, then return to sign in.",
    }),
  );
}
