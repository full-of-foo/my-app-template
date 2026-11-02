import { it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { createFirebaseAuth } from "./firebase-auth";
import { createApp } from "./app";
import { createPool, migrate } from "./database";

it.skipIf(!process.env.RUN_FIREBASE_EMULATOR)(
  "preserves a legacy account through real emulator verification, reset and deletion",
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
    const pool = createPool(
      process.env.TEST_DATABASE_URL ??
        "postgresql://herpal:herpal_local_only@127.0.0.1:54324/herpal",
    );
    const app = createApp(pool, {
      origin: "http://localhost:5173",
      limits: false,
      firebase,
    });
    const username = `emu_${randomUUID().slice(0, 8)}`,
      email = `${username}@example.com`,
      password = "synthetic-password-for-emulator";
    let cookie = "",
      uid = "";
    const post = (path: string, body: object) =>
      request(app)
        .post(`/api${path}`)
        .set("Origin", "http://localhost:5173")
        .set("Cookie", cookie)
        .send(body);
    const action = async (type: string, method: string, extra: object = {}) => {
      const codes = (await (
        await fetch(
          `http://127.0.0.1:9099/emulator/v1/projects/${projectId}/oobCodes`,
        )
      ).json()) as {
        oobCodes: { email: string; requestType: string; oobCode: string }[];
      };
      const code = codes.oobCodes
        .filter((c) => c.email === email && c.requestType === type)
        .at(-1);
      expect(code).toBeDefined();
      const response = await transport(
        `https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=fake-emulator-key`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oobCode: code!.oobCode, ...extra }),
        },
      );
      expect(response.status).toBe(200);
    };
    try {
      await migrate(pool);
      const created = await post("/auth/register", { username, password });
      expect(created.status).toBe(201);
      cookie = created.headers["set-cookie"][0].split(";")[0];
      const original = await request(app)
        .get("/api/data")
        .set("Cookie", cookie);
      expect((await post("/account/email", { email, password })).status).toBe(
        200,
      );
      uid = (
        await pool.query("SELECT firebase_uid FROM users WHERE username=$1", [
          username,
        ])
      ).rows[0].firebase_uid;
      await action("VERIFY_EMAIL", "update");
      const verified = await post("/account/email/verify", { password });
      expect(verified.status).toBe(200);
      cookie = verified.headers["set-cookie"][0].split(";")[0];
      expect(
        (await request(app).get("/api/data").set("Cookie", cookie)).body,
      ).toEqual(original.body);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(
        (await post("/auth/email/request", { username, email })).status,
      ).toBe(200);
      // Delivery happens asynchronously after the neutral response.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const replacement = "a-new-emulator-password";
      await action("PASSWORD_RESET", "resetPassword", {
        newPassword: replacement,
      });
      expect(
        (await request(app).get("/api/data").set("Cookie", cookie)).status,
      ).toBe(401);
      expect((await post("/auth/login", { username, password })).status).toBe(
        401,
      );
      const login = await post("/auth/login", {
        username,
        password: replacement,
      });
      expect(login.status).toBe(200);
      cookie = login.headers["set-cookie"][0].split(";")[0];
      expect(
        (await request(app).get("/api/data").set("Cookie", cookie)).body,
      ).toEqual(original.body);
      expect(
        (
          await request(app)
            .delete("/api/account")
            .set("Cookie", cookie)
            .set("Origin", "http://localhost:5173")
            .send({ password: replacement })
        ).status,
      ).toBe(204);
      await expect(admin.getUser(uid)).rejects.toMatchObject({
        code: "auth/user-not-found",
      });
    } finally {
      if (uid) await admin.deleteUser(uid).catch(() => {});
      await pool.query("DELETE FROM users WHERE username=$1", [username]);
      await pool.end();
      await deleteApp(adminApp);
    }
  },
  30000,
);
