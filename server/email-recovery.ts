import type { Express, Request, Response, NextFunction } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { token, digest, hashPassword, verifyPassword } from "./security";
export type RecoveryMail = (
  to: string,
  subject: string,
  text: string,
) => Promise<void>;
export function recoveryMailer(): RecoveryMail | undefined {
  const key = process.env.RESEND_API_KEY,
    from = process.env.RECOVERY_EMAIL_FROM;
  if (!key || !from) return undefined;
  return async (to, subject, text) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    if (!response.ok)
      throw Error("Email delivery is unavailable. Please try again later.");
  };
}
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const codeSchema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{64}$/);
const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,40}$/);
type Guard = (req: Request, res: Response, next: NextFunction) => Promise<void>;
export function installEmailRecovery(
  app: Express,
  pool: Pool,
  options: {
    required: Guard;
    name: string;
    send?: RecoveryMail;
    limits?: boolean;
  },
) {
  const { required, name, send } = options;
  const available = (_req: Request, res: Response, next: NextFunction) => {
    if (!send) {
      res.status(503).json({
        error:
          "Email recovery isn’t available yet. Use your saved recovery code.",
      });
      return;
    }
    next();
  };
  if (options.limits !== false)
    app.use(
      "/api/account/email",
      rateLimit({
        windowMs: 3600000,
        limit: 15,
        skip: (req) => req.method === "GET",
        standardHeaders: "draft-8",
        legacyHeaders: false,
        message: { error: "Too many email attempts. Please try again later." },
      }),
    );
  app.get("/api/auth/email-capability", (_req, res) =>
    res.json({ available: !!send }),
  );
  app.get("/api/account/email", required, async (_req, res) => {
    const result = await pool.query(
      "SELECT recovery_email FROM users WHERE id=$1",
      [res.locals.user.id],
    );
    res.json({ available: !!send, email: result.rows[0].recovery_email });
  });
  async function withPassword(
    id: string,
    password: string,
    action: (client: import("pg").PoolClient) => Promise<void>,
  ) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const row = await client.query(
        "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (
        !row.rows[0] ||
        !(await verifyPassword(password, row.rows[0].password_hash))
      ) {
        await client.query("ROLLBACK");
        return false;
      }
      await action(client);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  app.post("/api/account/email", required, available, async (req, res) => {
    const input = z
      .object({ email: emailSchema, password: z.string().max(128) })
      .strict()
      .parse(req.body);
    const id = res.locals.user.id;
    const code = token();
    // Serialize password confirmation with resets and email changes.
    const valid = await withPassword(id, input.password, async (client) => {
      await client.query(
        "DELETE FROM email_challenges WHERE user_id=$1 AND purpose='verify'",
        [id],
      );
      await client.query(
        "INSERT INTO email_challenges(token_hash,user_id,email,purpose,expires_at) VALUES($1,$2,$3,'verify',now()+interval '15 minutes')",
        [digest(code), id, input.email],
      );
    });
    if (!valid) {
      res.status(401).json({ error: "The password did not match." });
      return;
    }
    try {
      await send!(
        input.email,
        `${name}: verify your recovery email`,
        `Enter this verification code in ${name}:\n\n${code}\n\nIt expires in 15 minutes. If you did not request this, ignore this email.`,
      );
    } catch {
      await pool.query("DELETE FROM email_challenges WHERE token_hash=$1", [
        digest(code),
      ]);
      res.status(503).json({
        error:
          "Email delivery is unavailable. Your recovery email has not changed. Try again later.",
      });
      return;
    }
    res.json({
      message: "Check your email and enter the verification code below.",
    });
  });
  app.post(
    "/api/account/email/verify",
    required,
    available,
    async (req, res) => {
      const { code } = z.object({ code: codeSchema }).strict().parse(req.body);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
          res.locals.user.id,
        ]);
        const result = await client.query(
          "DELETE FROM email_challenges WHERE token_hash=$1 AND user_id=$2 AND purpose='verify' AND expires_at>now() RETURNING email",
          [digest(code), res.locals.user.id],
        );
        if (!result.rows[0]) {
          await client.query("ROLLBACK");
          res.status(400).json({
            error: "That code is invalid or expired. Request a new one.",
          });
          return;
        }
        await client.query("UPDATE users SET recovery_email=$1 WHERE id=$2", [
          result.rows[0].email,
          res.locals.user.id,
        ]);
        await client.query("DELETE FROM email_challenges WHERE user_id=$1", [
          res.locals.user.id,
        ]);
        await client.query("COMMIT");
        res.json({ email: result.rows[0].email });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  );
  app.delete("/api/account/email", required, async (req, res) => {
    const { password } = z
      .object({ password: z.string().max(128) })
      .strict()
      .parse(req.body);
    const valid = await withPassword(
      res.locals.user.id,
      password,
      async (client) => {
        await client.query("UPDATE users SET recovery_email=NULL WHERE id=$1", [
          res.locals.user.id,
        ]);
        await client.query("DELETE FROM email_challenges WHERE user_id=$1", [
          res.locals.user.id,
        ]);
      },
    );
    if (!valid) {
      res.status(401).json({ error: "The password did not match." });
      return;
    }
    res.status(204).end();
  });
  app.post("/api/auth/email/request", available, async (req, res) => {
    const input = z
      .object({ username: usernameSchema, email: emailSchema })
      .strict()
      .parse(req.body);
    const code = token();
    // Atomic per-account quota prevents mail bombing across different IP addresses.
    const client = await pool.connect();
    let recipient: string | undefined;
    try {
      await client.query("BEGIN");
      const account = await client.query(
        "SELECT id,recovery_email FROM users WHERE username=$1 AND recovery_email=$2 FOR UPDATE",
        [input.username, input.email],
      );
      if (account.rows[0]) {
        const id = account.rows[0].id;
        await client.query(
          "DELETE FROM email_challenges WHERE expires_at<now()-interval '1 day'",
        );
        const issued = await client.query(
          "SELECT count(*)::int AS count FROM email_challenges WHERE user_id=$1 AND purpose='reset' AND created_at>now()-interval '1 hour'",
          [id],
        );
        if (issued.rows[0].count < 3) {
          await client.query(
            "INSERT INTO email_challenges(token_hash,user_id,email,purpose,expires_at) VALUES($1,$2,$3,'reset',now()+interval '15 minutes')",
            [digest(code), id, input.email],
          );
          recipient = input.email;
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    // Respond before talking to the mail provider: no account-existence delivery timing signal.
    res.json({
      message:
        "If that username has this verified email, a reset code will arrive shortly. Check spam too. You can request up to three codes per hour.",
    });
    if (recipient)
      void send!(
        recipient,
        `${name}: reset your password`,
        `Enter this reset code in ${name} under Forgot password → Email recovery:\n\n${code}\n\nIt expires in 15 minutes and works once. If you did not request it, ignore this email. Your password has not changed.`,
      ).catch(() => {
        console.error(
          "Password reset email delivery failed; no account details logged.",
        );
      });
  });
  app.post("/api/auth/email/reset", available, async (req, res) => {
    const input = z
      .object({
        username: usernameSchema,
        code: codeSchema,
        password: z.string().min(12).max(128),
      })
      .strict()
      .parse(req.body);
    const password = await hashPassword(input.password),
      replacement = token();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const user = await client.query(
        "SELECT id,recovery_email FROM users WHERE username=$1 FOR UPDATE",
        [input.username],
      );
      const row = user.rows[0];
      const result = row
        ? await client.query(
            "DELETE FROM email_challenges WHERE token_hash=$1 AND user_id=$2 AND email=$3 AND purpose='reset' AND expires_at>now() RETURNING user_id",
            [digest(input.code), row.id, row.recovery_email],
          )
        : null;
      if (!result?.rows[0]) {
        await client.query("ROLLBACK");
        res.status(400).json({
          error: "That code is invalid or expired. Request a new one.",
        });
        return;
      }
      await client.query(
        "UPDATE users SET password_hash=$1,recovery_hash=$2 WHERE id=$3",
        [password, digest(replacement), row.id],
      );
      await client.query("DELETE FROM sessions WHERE user_id=$1", [row.id]);
      await client.query("DELETE FROM email_challenges WHERE user_id=$1", [
        row.id,
      ]);
      await client.query("COMMIT");
      res.json({
        recoveryCode: replacement,
        message:
          "Password updated. Save your new recovery code, then sign in with your new password.",
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}
