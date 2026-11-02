import { beforeAll, afterAll, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "./app";
import { createPool, migrate } from "./database";
import type { FirebaseAuth } from "./firebase-auth";
import { FirebaseAuthError } from "./firebase-auth";
import type { UserRecord, DecodedIdToken } from "firebase-admin/auth";
const pool = createPool(
  process.env.TEST_DATABASE_URL ??
    "postgresql://herpal:herpal_local_only@127.0.0.1:54324/onboarding_template",
);
const origin = "http://localhost:5173";
const username = `firebase_${randomUUID().slice(0, 8)}`;
const password = "synthetic-long-password";
const email = `${username}@example.com`;
let remote: { -readonly [K in keyof UserRecord]: UserRecord[K] } | undefined;
let remotePassword = password;
const token = () =>
  ({
    uid: remote!.uid,
    email_verified: remote!.emailVerified,
  }) as DecodedIdToken;
const missing = () =>
  Object.assign(new Error("missing"), { code: "auth/user-not-found" });
const firebase: FirebaseAuth = {
  createUser: vi.fn(async (uid, email) => {
    remote = {
      uid,
      email,
      emailVerified: false,
      disabled: false,
      tokensValidAfterTime: "Mon, 02 Nov 2026 12:00:00 GMT",
    } as UserRecord;
    return remote;
  }),
  getUser: vi.fn(async (uid) => {
    if (!remote || remote.uid !== uid) throw missing();
    return remote;
  }),
  signIn: vi.fn(async (email, supplied) => {
    if (!remote || remote.email !== email || supplied !== remotePassword)
      throw new FirebaseAuthError("credentials");
    return token();
  }),
  passwordSession: vi.fn(async (email, supplied) => {
    if (!remote || remote.email !== email || supplied !== remotePassword)
      throw new FirebaseAuthError("credentials");
    return { verified: token(), idToken: "synthetic" };
  }),
  verifyIdToken: vi.fn(async () => token()),
  sendVerification: vi.fn(async () => {}),
  sendPasswordReset: vi.fn(async () => {}),
  deleteUser: vi.fn(async () => {
    remote = undefined;
  }),
};
const app = createApp(pool, { origin, limits: false, firebase });
const disabled = createApp(pool, { origin, limits: false });
let cookie = "",
  originalCookie = "",
  id = "",
  recoveryCode = "";
const post = (path: string, body: object, auth = true, target = app) =>
  request(target)
    .post(`/api${path}`)
    .set("Origin", origin)
    .set("Cookie", auth ? cookie : "")
    .send(body);
const get = (path: string, session = cookie, target = app) =>
  request(target).get(`/api${path}`).set("Cookie", session);
beforeAll(async () => {
  await migrate(pool);
  const r = await post("/auth/register", { username, password }, false);
  expect(r.status).toBe(201);
  cookie = r.headers["set-cookie"][0].split(";")[0];
  originalCookie = cookie;
  id = r.body.user.id;
  recoveryCode = r.body.recoveryCode;
});
afterAll(async () => {
  await pool.query("DELETE FROM users WHERE username=$1", [username]);
  await pool.end();
});
it("hides the Firebase flow from installed app versions that predate it", async () => {
  expect((await get("/auth/email-capability")).body).toEqual({ available: false });
  expect((await get("/account/email")).body).toEqual({ available: false, email: null });
  expect((await get("/auth/email-capability?protocol=firebase")).body).toEqual({
    available: true,
    provider: "firebase",
  });
  expect((await get("/account/email?protocol=firebase")).body).toMatchObject({
    provider: "firebase",
    state: null,
  });
});
it("enrolls only after password confirmation and verified email, preserving records", async () => {
  const before = await get("/data");
  expect(
    (await post("/account/email", { email, password: "wrong" })).status,
  ).toBe(401);
  expect(firebase.createUser).not.toHaveBeenCalled();
  expect((await post("/account/email", { email, password })).status).toBe(200);
  expect(remote!.emailVerified).toBe(false);
  expect((await post("/account/email/verify", { password })).status).toBe(400);
  expect(
    (await post("/auth/login", { username, password }, false)).status,
  ).toBe(200);
  remote!.emailVerified = true;
  const r = await post("/account/email/verify", { password });
  expect(r.status).toBe(200);
  cookie = r.headers["set-cookie"][0].split(";")[0];
  expect((await get("/data")).body).toEqual(before.body);
  expect((await get("/data", originalCookie)).status).toBe(401);
  expect(
    (await pool.query("SELECT password_hash FROM users WHERE id=$1", [id]))
      .rows[0].password_hash,
  ).toBe("firebase");
});
it("does not permit saved-code fallback or provider-disable bypass", async () => {
  expect(
    (await post("/auth/recover", { username, password, recoveryCode }, false))
      .status,
  ).toBe(400);
  expect(
    (await post("/auth/login", { username, password }, false, disabled)).status,
  ).toBe(503);
  expect((await get("/data", cookie, disabled)).status).toBe(401);
});
it("uses hosted resets and revokes every old session after the Firebase password changes", async () => {
  const known = await post("/auth/email/request", { username, email }, false);
  const unknown = await post(
    "/auth/email/request",
    { username: "unknown", email },
    false,
  );
  expect(known.body).toEqual(unknown.body);
  await vi.waitFor(() =>
    expect(firebase.sendPasswordReset).toHaveBeenCalledTimes(1),
  );
  expect(
    (await post("/auth/email/request", { username, email }, false)).body,
  ).toEqual(known.body);
  expect(firebase.sendPasswordReset).toHaveBeenCalledTimes(1);
  remotePassword = "replacement-long-password";
  remote!.tokensValidAfterTime = "Mon, 02 Nov 2026 13:00:00 GMT";
  expect((await get("/data")).status).toBe(401);
  expect(
    (await post("/auth/login", { username, password }, false)).status,
  ).toBe(401);
  const r = await post(
    "/auth/login",
    { username, password: remotePassword },
    false,
  );
  expect(r.status).toBe(200);
  cookie = r.headers["set-cookie"][0].split(";")[0];
  expect((await get("/data")).status).toBe(200);
});
it("requires the Firebase password to delete both identity and app records", async () => {
  const erase = (password: string) =>
    request(app)
      .delete("/api/account")
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ password });
  expect((await erase(password)).status).toBe(401);
  expect((await erase(remotePassword)).status).toBe(204);
  expect(remote).toBeUndefined();
  expect((await get("/data")).status).toBe(401);
  expect(
    (await pool.query("SELECT id FROM users WHERE id=$1", [id])).rowCount,
  ).toBe(0);
});
