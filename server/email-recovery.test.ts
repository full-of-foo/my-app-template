import { beforeAll, afterAll, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createPool, migrate } from "./database";
import { createApp } from "./app";
import { digest } from "./security";
const pool = createPool(
  process.env.TEST_DATABASE_URL ??
    "postgresql://app:app_local_only@127.0.0.1:54330/app_test",
);
const origin = "http://localhost:5173";
const mail: { to: string; text: string }[] = [];
const app = createApp(pool, {
  origin,
  limits: false,
  recoveryMail: async (to, _subject, text) => {
    mail.push({ to, text });
  },
});
const username = `email_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
const password = "a-private-long-password";
const email = "synthetic@example.com";
let cookie: string;
let id: string;
let recoveryCode: string;
const post = (url: string, body: object, auth = false) =>
  request(app)
    .post(`/api${url}`)
    .set("Origin", origin)
    .set("Cookie", auth ? cookie : "")
    .send(body);
const latestCode = () => mail.at(-1)!.text.match(/[a-f0-9]{64}/)![0];
beforeAll(async () => {
  await migrate(pool);
  await migrate(pool);
  const r = await post("/auth/register", { username, password });
  expect(r.status).toBe(201);
  cookie = r.headers["set-cookie"][0].split(";")[0];
  id = r.body.user.id;
  recoveryCode = r.body.recoveryCode;
});
afterAll(async () => {
  await pool.query("DELETE FROM users WHERE username=$1", [username]);
  await pool.end();
});
it("requires authenticated password confirmation and verifies the mailbox before recovery", async () => {
  expect((await post("/account/email", { email, password })).status).toBe(401);
  expect(
    (await post("/account/email", { email, password: "wrong" }, true)).status,
  ).toBe(401);
  expect((await post("/account/email", { email, password }, true)).status).toBe(
    200,
  );
  const code = latestCode();
  expect(mail).toHaveLength(1);
  expect(
    (await pool.query("SELECT recovery_email FROM users WHERE id=$1", [id]))
      .rows[0].recovery_email,
  ).toBeNull();
  expect(
    (
      await pool.query(
        "SELECT token_hash FROM email_challenges WHERE user_id=$1",
        [id],
      )
    ).rows[0].token_hash,
  ).toBe(digest(code));
  const unknown = await post("/auth/email/request", {
    username: "no_such_user",
    email,
  });
  const unverified = await post("/auth/email/request", { username, email });
  expect(unverified.body).toEqual(unknown.body);
  expect(mail).toHaveLength(1);
  expect(
    (await post("/auth/email/reset", { username, code, password })).status,
  ).toBe(400);
  expect((await post("/account/email/verify", { code }, true)).body.email).toBe(
    email,
  );
  expect((await post("/account/email/verify", { code }, true)).status).toBe(
    400,
  );
});
it("expires codes, limits email requests per account, resets once and revokes all sessions and old recovery codes", async () => {
  const wrong = await post("/auth/email/request", {
    username,
    email: "wrong@example.com",
  });
  const ok = await post("/auth/email/request", { username, email });
  expect(ok.body).toEqual(wrong.body);
  const expired = latestCode();
  await pool.query(
    "UPDATE email_challenges SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",
    [digest(expired)],
  );
  expect(
    (await post("/auth/email/reset", { username, code: expired, password }))
      .status,
  ).toBe(400);
  await post("/auth/email/request", { username, email });
  const valid = latestCode();
  await post("/auth/email/request", { username, email });
  const count = mail.length;
  await post("/auth/email/request", { username, email });
  expect(mail).toHaveLength(count);
  const newer = "a-completely-new-password";
  const [a, b] = await Promise.all([
    post("/auth/email/reset", { username, code: valid, password: newer }),
    post("/auth/email/reset", { username, code: valid, password: newer }),
  ]);
  expect([a.status, b.status].sort()).toEqual([200, 400]);
  expect((a.status === 200 ? a : b).body.recoveryCode).toMatch(
    /^[a-f0-9]{64}$/,
  );
  expect(
    (await request(app).get("/api/auth/session").set("Cookie", cookie)).body
      .user,
  ).toBeNull();
  expect((await post("/auth/login", { username, password })).status).toBe(401);
  expect(
    (await post("/auth/recover", { username, password, recoveryCode })).status,
  ).toBe(401);
  const login = await post("/auth/login", { username, password: newer });
  expect(login.status).toBe(200);
  cookie = login.headers["set-cookie"][0].split(";")[0];
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM email_challenges WHERE user_id=$1",
        [id],
      )
    ).rows[0].n,
  ).toBe(0);
});
it("does not replace a verified email until verification and permits removal", async () => {
  expect(
    (
      await post(
        "/account/email",
        { email: "other@example.com", password: "a-completely-new-password" },
        true,
      )
    ).status,
  ).toBe(200);
  expect(
    (await request(app).get("/api/account/email").set("Cookie", cookie)).body
      .email,
  ).toBe(email);
  expect(
    (
      await request(app)
        .delete("/api/account/email")
        .set("Origin", origin)
        .set("Cookie", cookie)
        .send({ password: "a-completely-new-password" })
    ).status,
  ).toBe(204);
  expect(
    (await request(app).get("/api/account/email").set("Cookie", cookie)).body
      .email,
  ).toBeNull();
  expect(
    (await post("/account/email/verify", { code: latestCode() }, true)).status,
  ).toBe(400);
});
it("reports sender failures without changing verified state or retaining the failed challenge", async () => {
  const broken = createApp(pool, {
    origin,
    limits: false,
    recoveryMail: async () => {
      throw Error("provider credentials must not leak");
    },
  });
  const result = await request(broken)
    .post("/api/account/email")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send({ email, password: "a-completely-new-password" });
  expect(result.status).toBe(503);
  expect(result.text).not.toContain("credentials");
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM email_challenges WHERE user_id=$1",
        [id],
      )
    ).rows[0].n,
  ).toBe(0);
});
