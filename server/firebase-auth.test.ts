import { describe, expect, it, vi } from "vitest";
import { scryptSync } from "node:crypto";
import type { Auth, DecodedIdToken } from "firebase-admin/auth";
import {
  createFirebaseAuth,
  firebaseImportRecord,
  firebasePasswordHash,
} from "./firebase-auth";
import { hashPassword } from "./security";

const uid = "e34c1046-7d70-4d06-b7be-ec61bff27f45";
const verified = { uid, email_verified: true } as DecodedIdToken;
function setup() {
  const admin = {
    createUser: vi.fn<Auth["createUser"]>(),
    verifyIdToken: vi.fn<Auth["verifyIdToken"]>().mockResolvedValue(verified),
    getUser: vi.fn<Auth["getUser"]>(),
    importUsers: vi.fn<Auth["importUsers"]>(),
    deleteUser: vi.fn<Auth["deleteUser"]>(),
    createCustomToken: vi
      .fn<Auth["createCustomToken"]>()
      .mockResolvedValue("custom-token"),
  };
  const transport = vi.fn<typeof fetch>();
  return { admin, transport, auth: createFirebaseAuth(admin, transport) };
}
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe("Firebase adapter preparation", () => {
  it("preserves standard scrypt hash and salt bytes when preparing a legacy identity", async () => {
    const password = "synthetic-password-for-import";
    const record = firebaseImportRecord({
      id: uid,
      username: "synthetic",
      email: "synthetic@example.com",
      passwordHash: await hashPassword(password),
    });
    expect(record.uid).toBe(uid);
    expect(record.emailVerified).toBe(false);
    expect(record.passwordSalt).toHaveLength(32);
    const derived = scryptSync(
      password,
      record.passwordSalt!,
      firebasePasswordHash.derivedKeyLength,
      {
        N: firebasePasswordHash.memoryCost,
        r: firebasePasswordHash.blockSize,
        p: firebasePasswordHash.parallelization,
        maxmem: 64 * 1024 * 1024,
      },
    );
    expect(derived).toEqual(record.passwordHash);
  });
  it("rejects malformed legacy hashes without including their contents in errors", () => {
    expect(() =>
      firebaseImportRecord({
        id: uid,
        username: "synthetic",
        email: "synthetic@example.com",
        passwordHash: "secret-invalid-hash",
      }),
    ).toThrow("The account cannot be imported.");
  });
  it("verifies provider sign-in tokens and revocation before returning an identity", async () => {
    const { auth, admin, transport } = setup();
    transport.mockResolvedValue(
      reply({ localId: uid, idToken: "synthetic-token" }),
    );
    expect(
      await auth.signIn("synthetic@example.com", "synthetic-password"),
    ).toEqual(verified);
    expect(admin.verifyIdToken).toHaveBeenCalledWith("synthetic-token", true);
    const [url, init] = transport.mock.calls[0];
    expect(new URL(String(url)).hostname).toBe(
      "identitytoolkit.googleapis.com",
    );
    expect(init?.redirect).toBe("error");
  });
  it("rejects a mismatched identity or a revoked token", async () => {
    const { auth, admin, transport } = setup();
    transport.mockImplementation(async () =>
      reply({ localId: "other-user", idToken: "synthetic-token" }),
    );
    await expect(
      auth.signIn("synthetic@example.com", "synthetic-password"),
    ).rejects.toMatchObject({ kind: "credentials" });
    admin.verifyIdToken.mockRejectedValue(new Error("revoked"));
    await expect(auth.verifyIdToken("synthetic-token")).rejects.toThrow(
      "revoked",
    );
  });
  it.each([
    "EMAIL_NOT_FOUND",
    "INVALID_PASSWORD",
    "INVALID_LOGIN_CREDENTIALS",
    "USER_DISABLED",
  ])("normalizes %s", async (message) => {
    const { auth, transport } = setup();
    transport.mockResolvedValue(reply({ error: { message } }, 400));
    await expect(
      auth.signIn("synthetic@example.com", "synthetic-password"),
    ).rejects.toMatchObject({ kind: "credentials" });
  });
  it("keeps reset requests neutral for unknown addresses", async () => {
    const { auth, transport } = setup();
    transport.mockResolvedValue(
      reply({ error: { message: "EMAIL_NOT_FOUND" } }, 400),
    );
    await expect(
      auth.sendPasswordReset("synthetic@example.com"),
    ).resolves.toBeUndefined();
  });
  it("reports quota and network failures without exposing provider details", async () => {
    const { auth, transport } = setup();
    transport.mockResolvedValue(
      reply({ error: { message: "QUOTA_EXCEEDED" } }, 429),
    );
    await expect(
      auth.sendPasswordReset("synthetic@example.com"),
    ).rejects.toMatchObject({ kind: "unavailable" });
    transport.mockRejectedValue(new Error("sensitive provider detail"));
    await expect(
      auth.signIn("synthetic@example.com", "synthetic-password"),
    ).rejects.toThrow("Account sign-in is temporarily unavailable.");
  });
  it("fails closed on malformed provider responses", async () => {
    const { auth, transport } = setup();
    transport.mockResolvedValue(reply({}));
    await expect(
      auth.signIn("synthetic@example.com", "synthetic-password"),
    ).rejects.toMatchObject({ kind: "unavailable" });
    transport.mockResolvedValue(new Response("not JSON"));
    await expect(
      auth.sendPasswordReset("synthetic@example.com"),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });
  it("sends hosted verification emails for a known user without their password", async () => {
    const { auth, admin, transport } = setup();
    transport
      .mockResolvedValueOnce(reply({ idToken: "user-token" }))
      .mockResolvedValueOnce(reply({}));
    await auth.sendVerification(uid);
    expect(admin.createCustomToken).toHaveBeenCalledWith(uid);
    expect(admin.verifyIdToken).toHaveBeenCalledWith("user-token", true);
    expect(JSON.parse(String(transport.mock.calls[1][1]?.body))).toEqual({
      requestType: "VERIFY_EMAIL",
      idToken: "user-token",
    });
    transport.mockClear();
    transport.mockResolvedValueOnce(reply({ idToken: "other-token" }));
    admin.verifyIdToken.mockResolvedValueOnce({
      uid: "someone-else",
    } as DecodedIdToken);
    await expect(auth.sendVerification(uid)).rejects.toMatchObject({
      kind: "unavailable",
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
