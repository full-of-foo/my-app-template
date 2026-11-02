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
const tag = randomUUID().slice(0, 8);
const email = `new_${tag}@example.com`;
const legacyName = `legacy_${tag}`;
const legacyEmail = `legacy_${tag}@example.com`;
const password = "synthetic-long-password";

type Remote = { -readonly [K in keyof UserRecord]: UserRecord[K] } & {
  password: string;
};
const remotes = new Map<string, Remote>();
const byEmail = (address: string) =>
  [...remotes.values()].find((r) => r.email === address);
const missing = () =>
  Object.assign(new Error("missing"), { code: "auth/user-not-found" });
const firebase: FirebaseAuth = {
  createUser: vi.fn(async (uid, address, secret) => {
    if (byEmail(address))
      throw Object.assign(new Error("taken"), {
        code: "auth/email-already-exists",
      });
    const record = {
      uid,
      email: address,
      emailVerified: false,
      disabled: false,
      tokensValidAfterTime: "Mon, 02 Nov 2026 12:00:00 GMT",
      password: secret,
    } as Remote;
    remotes.set(uid, record);
    return record;
  }),
  getUser: vi.fn(async (uid) => {
    const record = remotes.get(uid);
    if (!record) throw missing();
    return record;
  }),
  signIn: vi.fn(async (address, secret) => {
    const record = byEmail(address);
    if (!record || record.password !== secret || record.disabled)
      throw new FirebaseAuthError("credentials");
    return { uid: record.uid } as DecodedIdToken;
  }),
  passwordSession: vi.fn(async () => {
    throw new Error("unused");
  }),
  verifyIdToken: vi.fn(async () => ({}) as DecodedIdToken),
  sendVerification: vi.fn(async () => {}),
  sendPasswordReset: vi.fn(async () => {}),
  deleteUser: vi.fn(async (uid) => {
    if (!remotes.delete(uid)) throw missing();
  }),
};
const app = createApp(pool, { origin, limits: false, firebase });
const disabled = createApp(pool, { origin, limits: false });
const cookieOf = (r: request.Response) =>
  (r.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
const post = (path: string, body: object, cookie = "", target = app) =>
  request(target)
    .post(`/api${path}`)
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send(body);
const get = (path: string, cookie = "", target = app) =>
  request(target).get(`/api${path}`).set("Cookie", cookie);
const erase = (cookie: string, secret: string) =>
  request(app)
    .delete("/api/account")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send({ password: secret });

let emailCookie = "";
let legacyCookie = "";
let legacyRecoveryCode = "";
beforeAll(async () => {
  await migrate(pool);
  const legacy = await post("/auth/register", {
    username: legacyName,
    password,
  });
  expect(legacy.status).toBe(201);
  legacyCookie = cookieOf(legacy);
  legacyRecoveryCode = legacy.body.recoveryCode;
});
afterAll(async () => {
  await pool.query(
    "DELETE FROM users WHERE username=$1 OR firebase_email IN ($2,$3)",
    [legacyName, email, legacyEmail],
  );
  await pool.end();
});

it("advertises email accounts only to app versions that support them", async () => {
  expect((await get("/auth/email-capability")).body).toEqual({
    available: false,
  });
  expect((await get("/auth/email-capability?protocol=firebase")).body).toEqual(
    { available: true, provider: "firebase", accounts: "email" },
  );
  expect(
    (await get("/auth/email-capability?protocol=firebase", "", disabled)).body,
  ).toEqual({ available: false });
  expect((await get("/account/email", legacyCookie)).body).toEqual({
    available: false,
    email: null,
  });
});

it("registers with email and password, then signs in with email", async () => {
  expect(
    (await post("/auth/register", { email, password: "too-short" })).status,
  ).toBe(400);
  const created = await post("/auth/register", {
    email: email.toUpperCase(),
    password,
  });
  expect(created.status).toBe(201);
  expect(created.body.user).toMatchObject({ username: null, email });
  expect(created.body.recoveryCode).toBeUndefined();
  expect(firebase.sendVerification).toHaveBeenCalledWith(created.body.user.id);
  emailCookie = cookieOf(created);
  expect((await get("/auth/session", emailCookie)).body.user).toMatchObject({
    email,
  });
  expect((await get("/data", emailCookie)).status).toBe(200);
  expect(
    (await get("/account/email?protocol=firebase", emailCookie)).body,
  ).toMatchObject({ state: "active", email, emailVerified: false });

  expect(
    (await post("/auth/register", { email, password })).status,
  ).toBe(409);
  expect(
    (await post("/auth/login", { email, password: "wrong-password-here" }))
      .status,
  ).toBe(401);
  expect(
    (await post("/auth/login", { email: "nobody@example.com", password }))
      .status,
  ).toBe(401);
  const signedIn = await post("/auth/login", { email, password });
  expect(signedIn.status).toBe(200);
  expect(signedIn.body.user.email).toBe(email);
  emailCookie = cookieOf(signedIn);
});

it("rate-limits verification resends", async () => {
  const r = await post(
    "/account/email/verification?protocol=firebase",
    {},
    emailCookie,
  );
  expect(r.status).toBe(429);
  await pool.query(
    "UPDATE users SET firebase_last_mail_at=NULL WHERE firebase_email=$1",
    [email],
  );
  expect(
    (await post("/account/email/verification?protocol=firebase", {}, emailCookie))
      .status,
  ).toBe(200);
});

it("upgrades a username account to email sign-in and keeps its records", async () => {
  const before = await get("/data", legacyCookie);
  expect(before.status).toBe(200);
  expect(
    (await post("/account/email?protocol=firebase", { email, password }, legacyCookie))
      .status,
  ).toBe(409);
  expect(
    (
      await post(
        "/account/email?protocol=firebase",
        { email: legacyEmail, password: "wrong-password-here" },
        legacyCookie,
      )
    ).status,
  ).toBe(401);
  const other = await post("/auth/login", { username: legacyName, password });
  expect(other.status).toBe(200);
  const upgraded = await post(
    "/account/email?protocol=firebase",
    { email: legacyEmail, password },
    legacyCookie,
  );
  expect(upgraded.status).toBe(200);
  expect(upgraded.body.user).toMatchObject({
    username: legacyName,
    email: legacyEmail,
  });
  const fresh = cookieOf(upgraded);
  expect((await get("/data", fresh)).body).toEqual(before.body);
  // The other device and the old session are signed out; the saved code is retired.
  expect((await get("/data", cookieOf(other))).status).toBe(401);
  expect((await get("/data", legacyCookie)).status).toBe(401);
  expect(
    (
      await post("/auth/recover", {
        username: legacyName,
        password: "another-long-password",
        recoveryCode: legacyRecoveryCode,
      })
    ).status,
  ).toBe(400);
  const byEmailLogin = await post("/auth/login", {
    email: legacyEmail,
    password,
  });
  expect(byEmailLogin.status).toBe(200);
  // Older installed versions can still sign in with the username.
  expect(
    (await post("/auth/login", { username: legacyName, password })).status,
  ).toBe(200);
  legacyCookie = cookieOf(byEmailLogin);
  expect(
    (
      await post(
        "/account/email?protocol=firebase",
        { email: legacyEmail, password },
        legacyCookie,
      )
    ).status,
  ).toBe(400);
});

it("sends neutral reset emails and revokes sessions after a Firebase password change", async () => {
  await pool.query(
    "UPDATE users SET firebase_last_mail_at=NULL WHERE firebase_email=$1",
    [email],
  );
  const known = await post("/auth/email/request", { email });
  const unknown = await post("/auth/email/request", {
    email: "unknown@example.com",
  });
  expect(known.status).toBe(200);
  expect(known.body).toEqual(unknown.body);
  await vi.waitFor(() =>
    expect(firebase.sendPasswordReset).toHaveBeenCalledWith(email),
  );
  const remote = [...remotes.values()].find((r) => r.email === email)!;
  remote.password = "replacement-long-password";
  remote.tokensValidAfterTime = "Mon, 02 Nov 2026 13:00:00 GMT";
  expect((await get("/data", emailCookie)).status).toBe(401);
  expect((await post("/auth/login", { email, password })).status).toBe(401);
  const r = await post("/auth/login", {
    email,
    password: "replacement-long-password",
  });
  expect(r.status).toBe(200);
  emailCookie = cookieOf(r);
});

it("never falls back to local passwords when the provider is unavailable", async () => {
  expect(
    (await post("/auth/login", { email, password }, "", disabled)).status,
  ).toBe(503);
  expect(
    (await post("/auth/login", { username: legacyName, password }, "", disabled))
      .status,
  ).toBe(503);
  expect((await get("/data", emailCookie, disabled)).status).toBe(401);
});

it("deletes the Firebase identity and the records with the current password", async () => {
  expect((await erase(emailCookie, password)).status).toBe(401);
  expect((await erase(emailCookie, "replacement-long-password")).status).toBe(
    204,
  );
  expect(byEmail(email)).toBeUndefined();
  expect(
    (await pool.query("SELECT id FROM users WHERE firebase_email=$1", [email]))
      .rowCount,
  ).toBe(0);
  expect((await erase(legacyCookie, password)).status).toBe(204);
  expect(byEmail(legacyEmail)).toBeUndefined();
});
