import {
  installEmailRecovery,
  recoveryMailer,
  type RecoveryMail,
} from "./email-recovery";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { z } from "zod";
import { hashPassword, verifyPassword, token, digest } from "./security";
import { documentSchema, emptyDocument } from "../src/data";
import { config } from "../src/config";
const credentials = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9_]{3,40}$/, "Use 3–40 letters, numbers or underscores."),
    password: z.string().min(12).max(128),
  })
  .strict();
const writeSchema = z
  .object({ revision: z.number().int().min(0), data: documentSchema })
  .strict();
type Options = {
  origin: string;
  production?: boolean;
  limits?: boolean;
  staticDir?: string;
  recoveryMail?: RecoveryMail;
};
export function createApp(pool: Pool, options: Options) {
  const app = express();
  const dummyPassword = hashPassword("unused-account-comparison");
  app.disable("x-powered-by");
  if (options.production) app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          workerSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: options.production ? [] : null,
        },
      },
      referrerPolicy: { policy: "no-referrer" },
    }),
  );
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });
  app.use("/api", (req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("origin") !== options.origin &&
      !(!options.production && req.get("origin") === "http://localhost:4173")
    ) {
      res
        .status(403)
        .json({ error: `This request did not come from ${config.name}.` });
      return;
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.method !== "DELETE" &&
      !req.is("application/json")
    ) {
      res.status(415).json({ error: "Use a JSON request." });
      return;
    }
    next();
  });
  app.use(express.json({ limit: "10mb" }));
  if (options.limits !== false) {
    app.use(
      "/api",
      rateLimit({
        windowMs: 60000,
        limit: 180,
        message: {
          error: "Too many requests. Please wait a minute before trying again.",
        },
        standardHeaders: "draft-8",
        legacyHeaders: false,
      }),
    );
    app.use(
      "/api/auth",
      rateLimit({
        windowMs: 15 * 60000,
        limit: 30,
        skip: (req) => req.method === "GET",
        standardHeaders: "draft-8",
        legacyHeaders: false,
        message: {
          error: "Too many attempts. Please wait a little before trying again.",
        },
      }),
    );
  }
  const cookieName = options.production ? "__Host-session" : "app_session";
  const cookieOptions = {
    httpOnly: true,
    secure: !!options.production,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 30 * 86400000,
  };
  async function makeSession(
    userId: string,
    connection: Pick<Pool, "query"> = pool,
  ) {
    const raw = token();
    await connection.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
      [digest(raw), userId],
    );
    return raw;
  }
  function cookie(req: Request) {
    return req.headers.cookie
      ?.split(";")
      .map((v) => v.trim().split("="))
      .find(([name]) => name === cookieName)?.[1];
  }
  async function identity(req: Request) {
    const raw = cookie(req);
    if (!raw) return null;
    const result = await pool.query<{ id: string; username: string }>(
      "SELECT u.id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
      [digest(raw)],
    );
    return result.rows[0] ?? null;
  }
  async function required(req: Request, res: Response, next: NextFunction) {
    const user = await identity(req);
    if (!user) {
      res.status(401).json({
        error:
          "Please sign in again. Your offline records are still on this device.",
      });
      return;
    }
    res.locals.user = user;
    next();
  }
  installEmailRecovery(app, pool, {
    required,
    name: config.name,
    send: options.recoveryMail ?? recoveryMailer(),
    limits: options.limits,
  });
  app.get("/api/health", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  });
  app.get("/api/auth/session", async (req, res) => {
    const user = await identity(req);
    if (user) {
      const raw = cookie(req)!;
      await pool.query(
        "UPDATE sessions SET expires_at=now()+interval '30 days' WHERE token_hash=$1",
        [digest(raw)],
      );
      res.cookie(cookieName, raw, cookieOptions);
    }
    res.json({ user });
  });
  app.post("/api/auth/register", async (req, res) => {
    const input = credentials.parse(req.body);
    const password = await hashPassword(input.password),
      recoveryCode = token(),
      id = randomUUID();
    const client = await pool.connect();
    let sessionToken = "";
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO users(id,username,password_hash,recovery_hash) VALUES($1,$2,$3,$4)",
        [id, input.username, password, digest(recoveryCode)],
      );
      await client.query(
        "INSERT INTO documents(user_id,document) VALUES($1,$2)",
        [id, JSON.stringify(emptyDocument())],
      );
      sessionToken = await makeSession(id, client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") {
        res.status(409).json({ error: "That username is unavailable." });
        return;
      }
      throw error;
    } finally {
      client.release();
    }
    res.cookie(cookieName, sessionToken, cookieOptions);
    res
      .status(201)
      .json({ user: { id, username: input.username }, recoveryCode });
  });
  app.post("/api/auth/login", async (req, res) => {
    const input = credentials.parse(req.body);
    const result = await pool.query<{
      id: string;
      username: string;
      password_hash: string;
    }>("SELECT id,username,password_hash FROM users WHERE username=$1", [
      input.username,
    ]);
    const row = result.rows[0];
    const valid = await verifyPassword(
      input.password,
      row?.password_hash ?? (await dummyPassword),
    );
    if (!row || !valid) {
      res
        .status(401)
        .json({ error: "The username or password did not match." });
      return;
    }
    const old = cookie(req);
    if (old)
      await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
        digest(old),
      ]);
    res.cookie(cookieName, await makeSession(row.id), cookieOptions);
    res.json({ user: { id: row.id, username: row.username } });
  });
  app.post("/api/auth/recover", async (req, res) => {
    const input = credentials
      .extend({ recoveryCode: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(req.body);
    const replacement = token(),
      password = await hashPassword(input.password);
    const client = await pool.connect();
    let recoveredId = "",
      sessionToken = "";
    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string }>(
        "UPDATE users SET password_hash=$1,recovery_hash=$2 WHERE username=$3 AND recovery_hash=$4 RETURNING id",
        [
          password,
          digest(replacement),
          input.username,
          digest(input.recoveryCode),
        ],
      );
      if (!result.rows[0]) {
        await client.query("ROLLBACK");
        res
          .status(401)
          .json({ error: "The username and recovery code did not match." });
        return;
      }
      recoveredId = result.rows[0].id;
      await client.query("DELETE FROM email_challenges WHERE user_id=$1", [
        recoveredId,
      ]);
      await client.query("DELETE FROM sessions WHERE user_id=$1", [
        recoveredId,
      ]);
      sessionToken = await makeSession(recoveredId, client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    res.cookie(cookieName, sessionToken, cookieOptions);
    res.json({
      user: { id: recoveredId, username: input.username },
      recoveryCode: replacement,
    });
  });
  app.post("/api/auth/logout", async (req, res) => {
    const raw = cookie(req);
    if (raw)
      await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
        digest(raw),
      ]);
    res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined });
    res.status(204).end();
  });
  app.get("/api/data", required, async (_req, res) => {
    const result = await pool.query<{ revision: number; document: unknown }>(
      "SELECT revision,document FROM documents WHERE user_id=$1",
      [res.locals.user.id],
    );
    res.json({
      revision: result.rows[0].revision,
      data: result.rows[0].document,
    });
  });
  app.put("/api/data", required, async (req, res) => {
    const input = writeSchema.parse(req.body);
    const result = await pool.query<{ revision: number }>(
      "UPDATE documents SET document=$1,revision=revision+1,updated_at=now() WHERE user_id=$2 AND revision=$3 RETURNING revision",
      [JSON.stringify(input.data), res.locals.user.id, input.revision],
    );
    if (!result.rows[0]) {
      res.status(409).json({
        error:
          "Your data changed on another device. Choose which copy to keep.",
      });
      return;
    }
    res.json({ revision: result.rows[0].revision });
  });
  app.delete("/api/data", required, async (_req, res) => {
    const result = await pool.query<{ revision: number }>(
      "UPDATE documents SET document=$1,revision=revision+1,updated_at=now() WHERE user_id=$2 RETURNING revision",
      [JSON.stringify(emptyDocument()), res.locals.user.id],
    );
    res.json({ revision: result.rows[0].revision });
  });
  app.delete("/api/account", required, async (req, res) => {
    const input = z
      .object({ password: z.string().max(128) })
      .strict()
      .parse(req.body);
    const account = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id=$1",
      [res.locals.user.id],
    );
    if (
      !(await verifyPassword(input.password, account.rows[0].password_hash))
    ) {
      res.status(401).json({ error: "The password did not match." });
      return;
    }
    await pool.query("DELETE FROM users WHERE id=$1", [res.locals.user.id]);
    res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined });
    res.status(204).end();
  });
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "This API endpoint does not exist." });
  });
  if (options.staticDir) {
    app.use(
      express.static(resolve(options.staticDir), {
        setHeaders: (res, path) => {
          res.setHeader(
            "Cache-Control",
            path.includes("/assets/")
              ? "public, max-age=31536000, immutable"
              : "no-cache",
          );
        },
      }),
    );
    app.get("/{*path}", (_req, res) =>
      res.sendFile(resolve(options.staticDir!, "index.html")),
    );
  }
  app.use(
    (error: unknown, _req: Request, res: Response, next: NextFunction) => {
      void next;
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: error.issues.map((i) => i.message).join(" ") });
        return;
      }
      if ((error as { type?: string }).type === "entity.too.large") {
        res.status(413).json({ error: "The request is too large." });
        return;
      }
      if (error instanceof SyntaxError) {
        res.status(400).json({ error: "The request is not valid JSON." });
        return;
      }
      res.status(503).json({
        error:
          "The service is temporarily unavailable. Your offline records are still on this device.",
      });
    },
  );
  return app;
}
