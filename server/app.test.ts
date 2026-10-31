import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createPool, migrate } from "./database";
import { createApp } from "./app";
import { hashPassword, verifyPassword, digest } from "./security";
import { emptyDocument } from "../src/data";
import { newNote } from "../src/features/notes/model";
const pool = createPool(
  process.env.TEST_DATABASE_URL ??
    "postgresql://app:app_local_only@127.0.0.1:54330/app_test",
);
const origin = "http://localhost:5173";
const app = createApp(pool, { origin, limits: false });
const username = `test_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
const password = "a-long-unique-test-password";
let cookie = "";
let recoveryCode = "";
let id = "";
const note = { ...newNote("Private test note", "sensitive test body") };
const body = { ...emptyDocument(), notes: [note] };
beforeAll(async () => {
  await migrate(pool);
  await migrate(pool);
});
afterAll(async () => {
  await pool.query("DELETE FROM users WHERE username LIKE $1", [
    `${username}%`,
  ]);
  await pool.end();
});
describe("real PostgreSQL account lifecycle", () => {
  it("has a live database and no unauthenticated access", async () => {
    expect((await request(app).get("/api/health")).body).toEqual({ ok: true });
    expect((await request(app).get("/api/auth/session")).body.user).toBeNull();
    expect((await request(app).get("/api/data")).status).toBe(401);
    expect((await request(app).get("/api/missing")).status).toBe(404);
  });
  it("rejects cross-origin, non-JSON and invalid registration", async () => {
    expect(
      (
        await request(app)
          .post("/api/auth/register")
          .send({ username, password })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/auth/register")
          .set("Origin", origin)
          .type("text")
          .send("abc")
      ).status,
    ).toBe(415);
    expect(
      (
        await request(app)
          .post("/api/auth/register")
          .set("Origin", origin)
          .send({ username: "x", password: "short" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/auth/register")
          .set("Origin", origin)
          .type("json")
          .send("{bad")
      ).status,
    ).toBe(400);
  });
  it("creates persistent accounts and strong session cookies; hashes secrets", async () => {
    const result = await request(app)
      .post("/api/auth/register")
      .set("Origin", origin)
      .send({ username, password });
    expect(result.status).toBe(201);
    id = result.body.user.id;
    recoveryCode = result.body.recoveryCode;
    expect(recoveryCode).toHaveLength(64);
    const cookies = result.headers["set-cookie"];
    cookie = String(cookies[0]).split(";")[0];
    expect(cookies[0]).toMatch(/HttpOnly/);
    expect(cookies[0]).toMatch(/SameSite=Lax/);
    expect(cookies[0]).toMatch(/Max-Age=2592000/);
    const stored = await pool.query(
      "SELECT password_hash,recovery_hash FROM users WHERE id=$1",
      [id],
    );
    expect(stored.rows[0].password_hash).not.toContain(password);
    expect(await verifyPassword(password, stored.rows[0].password_hash)).toBe(
      true,
    );
    expect(stored.rows[0].recovery_hash).toBe(digest(recoveryCode));
    expect(
      (
        await request(app)
          .post("/api/auth/register")
          .set("Origin", origin)
          .send({ username, password })
      ).status,
    ).toBe(409);
  });
  it("keeps login and records after constructing a new server instance", async () => {
    const write = await request(app)
      .put("/api/data")
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ revision: 0, data: body });
    expect(write.body.revision).toBe(1);
    const restarted = createApp(pool, { origin, limits: false });
    const session = await request(restarted)
      .get("/api/auth/session")
      .set("Cookie", cookie);
    expect(session.body.user).toEqual({ id, username });
    const result = await request(restarted)
      .get("/api/data")
      .set("Cookie", cookie);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.body.data).toEqual(body);
    expect(
      (
        await pool.query("SELECT token_hash FROM sessions WHERE user_id=$1", [
          id,
        ])
      ).rows[0].token_hash,
    ).not.toBe(cookie.split("=")[1]);
  });
  it("prevents cross-account access and stale overwrites", async () => {
    const other = await request(app)
      .post("/api/auth/register")
      .set("Origin", origin)
      .send({ username: `${username}_b`, password });
    const otherCookie = String(other.headers["set-cookie"][0]).split(";")[0];
    expect(
      (await request(app).get("/api/data").set("Cookie", otherCookie)).body.data
        .notes,
    ).toEqual([]);
    const denied = await request(app)
      .put("/api/data")
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ revision: 0, data: body });
    expect(denied.status).toBe(409);
    expect(
      (
        await request(app)
          .put("/api/data")
          .set("Origin", origin)
          .set("Cookie", cookie)
          .send({
            revision: 1,
            data: { ...body, notes: [note, note] },
          })
      ).status,
    ).toBe(400);
    expect(
      (await request(app).get("/api/data").set("Cookie", cookie)).body.data
        .notes[0].body,
    ).toBe("sensitive test body");
  });
  it("rejects bad login and expired sessions; rotates login tokens", async () => {
    expect(
      (
        await request(app)
          .post("/api/auth/login")
          .set("Origin", origin)
          .send({ username, password: "wrong-password-test" })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/auth/login")
          .set("Origin", origin)
          .send({ username: "nonexistent_account", password })
      ).status,
    ).toBe(401);
    const result = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ username, password });
    expect(result.status).toBe(200);
    expect(
      (await request(app).get("/api/data").set("Cookie", cookie)).status,
    ).toBe(401);
    cookie = String(result.headers["set-cookie"][0]).split(";")[0];
    await pool.query(
      "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
      [digest(cookie.split("=")[1])],
    );
    expect(
      (await request(app).get("/api/auth/session").set("Cookie", cookie)).body
        .user,
    ).toBeNull();
    const login = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ username, password });
    cookie = String(login.headers["set-cookie"][0]).split(";")[0];
  });
  it("recovers with a one-time code and invalidates old sessions", async () => {
    expect(
      (
        await request(app)
          .post("/api/auth/recover")
          .set("Origin", origin)
          .send({ username, password, recoveryCode: "a".repeat(64) })
      ).status,
    ).toBe(401);
    const recovered = await request(app)
      .post("/api/auth/recover")
      .set("Origin", origin)
      .send({ username, password, recoveryCode });
    expect(recovered.status).toBe(200);
    expect(recovered.body.recoveryCode).not.toBe(recoveryCode);
    expect(
      (await request(app).get("/api/data").set("Cookie", cookie)).status,
    ).toBe(401);
    cookie = String(recovered.headers["set-cookie"][0]).split(";")[0];
    expect(
      (
        await request(app)
          .post("/api/auth/recover")
          .set("Origin", origin)
          .send({ username, password, recoveryCode })
      ).status,
    ).toBe(401);
  });
  it("clears records, validates account deletion, and cascades sessions and data", async () => {
    expect(
      (
        await request(app)
          .delete("/api/data")
          .set("Origin", origin)
          .set("Cookie", cookie)
      ).body.revision,
    ).toBe(2);
    expect(
      (await request(app).get("/api/data").set("Cookie", cookie)).body.data
        .notes,
    ).toEqual([]);
    expect(
      (
        await request(app)
          .delete("/api/account")
          .set("Origin", origin)
          .set("Cookie", cookie)
          .send({ password: "wrong" })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .delete("/api/account")
          .set("Origin", origin)
          .set("Cookie", cookie)
          .send({ password })
      ).status,
    ).toBe(204);
    expect(
      (await pool.query("SELECT * FROM users WHERE id=$1", [id])).rowCount,
    ).toBe(0);
    expect(
      (await pool.query("SELECT * FROM sessions WHERE user_id=$1", [id]))
        .rowCount,
    ).toBe(0);
    expect(
      (await pool.query("SELECT * FROM documents WHERE user_id=$1", [id]))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await request(app)
          .post("/api/auth/logout")
          .set("Origin", origin)
          .send({})
      ).status,
    ).toBe(204);
  });
  it("handles signout, production secure cookies and password validation", async () => {
    const secure = createApp(pool, {
      origin: "https://app.example",
      production: true,
      limits: false,
    });
    const result = await request(secure)
      .post("/api/auth/login")
      .set("Origin", "https://app.example")
      .send({ username: `${username}_b`, password });
    expect(result.headers["set-cookie"][0]).toContain("__Host-session=");
    expect(result.headers["set-cookie"][0]).toContain("Secure");
    expect(result.headers["content-security-policy"]).toContain(
      "upgrade-insecure-requests",
    );
    const raw = String(result.headers["set-cookie"][0]).split(";")[0];
    expect(
      (
        await request(secure)
          .post("/api/auth/logout")
          .set("Origin", "https://app.example")
          .set("Cookie", raw)
          .send({})
      ).status,
    ).toBe(204);
    expect(await verifyPassword(password, "broken")).toBe(false);
    expect(await verifyPassword(password, "scrypt$valid$ff")).toBe(false);
    expect(await verifyPassword("bad", await hashPassword(password))).toBe(
      false,
    );
  });
});

it("serves the compiled app with security headers and deep-link fallback", async () => {
  const staticApp = createApp(pool, { origin, staticDir: "dist" });
  const root = await request(staticApp).get("/notes");
  expect(root.status).toBe(200);
  expect(root.text).toContain('<div id="root">');
  expect(root.headers["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect(root.headers["referrer-policy"]).toBe("no-referrer");
  expect(root.headers["content-security-policy"]).not.toContain(
    "upgrade-insecure-requests",
  );
  expect(root.headers["x-content-type-options"]).toBe("nosniff");
  const limited = createApp(pool, { origin });
  expect((await request(limited).get("/api/health")).status).toBe(200);
  expect(() => createPool("")).toThrow("DATABASE_URL");
});
it("enforces production request and authentication rate limits with useful JSON errors", async () => {
  const guarded = createApp(pool, { origin });
  for (let i = 0; i < 30; i++) {
    expect(
      (
        await request(guarded)
          .post("/api/auth/login")
          .set("Origin", origin)
          .send({ username: "x", password: "short" })
      ).status,
    ).toBe(400);
  }
  const authLimited = await request(guarded)
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ username: "x", password: "short" });
  expect(authLimited.status).toBe(429);
  expect(authLimited.body.error).toMatch(/Too many attempts/);
  for (let i = 0; i < 149; i++)
    expect((await request(guarded).get("/api/health")).status).toBe(200);
  const limited = await request(guarded).get("/api/health");
  expect(limited.status).toBe(429);
  expect(limited.body.error).toMatch(/Too many requests/);
});
