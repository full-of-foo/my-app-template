import { it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { createFirebaseAuth } from "./firebase-auth";
import { createApp } from "./app";
import { createPool, migrate } from "./database";

// Real Firebase Auth Emulator; run through `firebase emulators:exec` (see docs).
it.skipIf(!process.env.RUN_FIREBASE_EMULATOR)(
  "email accounts: register, verify, reset, upgrade a username account and delete",
  async () => {
    if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099")
      throw new Error("Only the local test emulator is allowed.");
    const projectId = "demo-auth-migration";
    const adminApp = initializeApp({ projectId }, `test-${randomUUID()}`);
    const admin = getAuth(adminApp);
    const transport: typeof fetch = (url, init) =>
      fetch(
        String(url).replace(
          "https://identitytoolkit.googleapis.com",
          "http://127.0.0.1:9099/identitytoolkit.googleapis.com",
        ),
        init,
      );
    const firebase = createFirebaseAuth(admin, transport, {
      projectId,
      apiKey: "fake-emulator-key",
    });
    const pool = createPool(process.env.TEST_DATABASE_URL);
    await migrate(pool);
    const app = createApp(pool, {
      origin: "http://localhost:5173",
      limits: false,
      firebase,
    });
    const tag = randomUUID().slice(0, 8);
    const email = `emu_${tag}@example.com`;
    const legacyName = `emu_${tag}`;
    const legacyEmail = `emu_old_${tag}@example.com`;
    const password = "synthetic-password-for-emulator";
    const post = (path: string, body: object, cookie = "") =>
      request(app)
        .post(`/api${path}`)
        .set("Origin", "http://localhost:5173")
        .set("Cookie", cookie)
        .send(body);
    const get = (path: string, cookie: string) =>
      request(app).get(`/api${path}`).set("Cookie", cookie);
    const cookieOf = (r: request.Response) =>
      (r.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
    const link = async (address: string, type: string) => {
      const { oobCodes } = (await (
        await fetch(
          `http://127.0.0.1:9099/emulator/v1/projects/${projectId}/oobCodes`,
        )
      ).json()) as {
        oobCodes: { email: string; requestType: string; oobLink: string }[];
      };
      const found = oobCodes
        .filter((c) => c.email === address && c.requestType === type)
        .at(-1);
      expect(found).toBeDefined();
      return found!.oobLink;
    };
    try {
      const created = await post("/auth/register", { email, password });
      expect(created.status).toBe(201);
      const uid = created.body.user.id as string;
      let cookie = cookieOf(created);
      expect((await get("/data", cookie)).status).toBe(200);
      expect((await admin.getUser(uid)).emailVerified).toBe(false);
      expect((await fetch(await link(email, "VERIFY_EMAIL"))).ok).toBe(true);
      expect((await admin.getUser(uid)).emailVerified).toBe(true);

      expect((await post("/auth/email/request", { email })).status).toBe(200);
      await expect.poll(() => link(email, "PASSWORD_RESET").catch(() => "")).not.toBe("");
      // Firebase records revocation to the second.
      await new Promise((r) => setTimeout(r, 1100));
      const reset = `${await link(email, "PASSWORD_RESET")}&newPassword=replacement-password-1`;
      expect((await fetch(reset)).ok).toBe(true);
      expect((await get("/data", cookie)).status).toBe(401);
      expect((await post("/auth/login", { email, password })).status).toBe(401);
      const relogin = await post("/auth/login", {
        email,
        password: "replacement-password-1",
      });
      expect(relogin.status).toBe(200);
      cookie = cookieOf(relogin);
      const removed = await request(app)
        .delete("/api/account")
        .set("Origin", "http://localhost:5173")
        .set("Cookie", cookie)
        .send({ password: "replacement-password-1" });
      expect(removed.status).toBe(204);
      await expect(admin.getUser(uid)).rejects.toMatchObject({
        code: "auth/user-not-found",
      });

      // A username account adds an email, keeps its records and then signs in by email.
      const legacy = await post("/auth/register", {
        username: legacyName,
        password,
      });
      expect(legacy.status).toBe(201);
      const before = await get("/data", cookieOf(legacy));
      const upgraded = await post(
        "/account/email?protocol=firebase",
        { email: legacyEmail, password },
        cookieOf(legacy),
      );
      expect(upgraded.status).toBe(200);
      expect((await get("/data", cookieOf(upgraded))).body).toEqual(before.body);
      const byEmail = await post("/auth/login", {
        email: legacyEmail,
        password,
      });
      expect(byEmail.status).toBe(200);
      expect(
        (
          await request(app)
            .delete("/api/account")
            .set("Origin", "http://localhost:5173")
            .set("Cookie", cookieOf(byEmail))
            .send({ password })
        ).status,
      ).toBe(204);
    } finally {
      await pool.query(
        "DELETE FROM users WHERE username=$1 OR firebase_email IN ($2,$3)",
        [legacyName, email, legacyEmail],
      );
      await pool.end();
      await deleteApp(adminApp);
    }
  },
);
