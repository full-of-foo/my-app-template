import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type Auth, type UserImportRecord } from "firebase-admin/auth";
import { z } from "zod";
import { firebaseConfig } from "./firebase-config";

const passwordResult = z.object({
  localId: z.string().min(1),
  idToken: z.string().min(1),
});

/** Never surface provider payloads: they can contain addresses or credentials. */
export class FirebaseAuthError extends Error {
  constructor(public readonly kind: "credentials" | "unavailable") {
    super(
      kind === "credentials"
        ? "The email or password did not match."
        : "Account sign-in is temporarily unavailable. Please try again.",
    );
  }
}

/** The local salt is ASCII hex text, not decoded hexadecimal bytes. */
export function firebaseImportRecord(account: {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
}): UserImportRecord {
  const parsed = z
    .object({
      id: z.string().uuid(),
      username: z.string().min(3).max(40),
      email: z.email(),
      passwordHash: z.string().regex(/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/),
    })
    .safeParse(account);
  if (!parsed.success) throw new Error("The account cannot be imported.");
  const [, salt, hash] = parsed.data.passwordHash.split("$");
  return {
    uid: parsed.data.id,
    displayName: parsed.data.username,
    email: parsed.data.email,
    // Ownership must be verified through Firebase before completing enrollment.
    emailVerified: false,
    passwordSalt: Buffer.from(salt, "utf8"),
    passwordHash: Buffer.from(hash, "hex"),
  };
}

export const firebasePasswordHash = {
  algorithm: "STANDARD_SCRYPT" as const,
  memoryCost: 32768,
  blockSize: 8,
  parallelization: 1,
  derivedKeyLength: 64,
};

/** Constructed explicitly by the future migration routes; importing this file activates nothing. */
export function createFirebaseAuth(
  admin: Pick<
    Auth,
    "verifyIdToken" | "getUser" | "deleteUser" | "createUser" | "createCustomToken"
  >,
  transport: typeof fetch = fetch,
  config = firebaseConfig,
) {
  async function request(action: string, body: object) {
    let response: Response;
    try {
      response = await transport(
        `https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${encodeURIComponent(config.apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
          redirect: "error",
        },
      );
    } catch {
      throw new FirebaseAuthError("unavailable");
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new FirebaseAuthError("unavailable");
    }
    if (!response.ok) {
      const message = z
        .object({ error: z.object({ message: z.string() }) })
        .safeParse(payload).data?.error.message;
      const invalid = [
        "INVALID_LOGIN_CREDENTIALS",
        "EMAIL_NOT_FOUND",
        "INVALID_PASSWORD",
        "USER_DISABLED",
      ].includes(message ?? "");
      throw new FirebaseAuthError(invalid ? "credentials" : "unavailable");
    }
    return payload;
  }
  async function passwordSession(email: string, password: string) {
    const result = passwordResult.safeParse(
      await request("signInWithPassword", {
        email,
        password,
        returnSecureToken: true,
      }),
    );
    if (!result.success) throw new FirebaseAuthError("unavailable");
    // Check signature, project, expiry and revocation using the official SDK.
    const verified = await admin.verifyIdToken(result.data.idToken, true);
    if (verified.uid !== result.data.localId)
      throw new FirebaseAuthError("credentials");
    return { verified, idToken: result.data.idToken };
  }
  return {
    passwordSession,
    async signIn(email: string, password: string) {
      return (await passwordSession(email, password)).verified;
    },
    createUser: (uid: string, email: string, password: string) =>
      admin.createUser({ uid, email, password, emailVerified: false }),
    verifyIdToken: (idToken: string) => admin.verifyIdToken(idToken, true),
    getUser: (uid: string) => admin.getUser(uid),
    /** Sends Firebase's hosted verification email without asking for the password again. */
    async sendVerification(uid: string) {
      const result = z.object({ idToken: z.string().min(1) }).safeParse(
        await request("signInWithCustomToken", {
          token: await admin.createCustomToken(uid),
          returnSecureToken: true,
        }),
      );
      if (
        !result.success ||
        (await admin.verifyIdToken(result.data.idToken, true)).uid !== uid
      )
        throw new FirebaseAuthError("unavailable");
      await request("sendOobCode", {
        requestType: "VERIFY_EMAIL",
        idToken: result.data.idToken,
      });
    },
    async sendPasswordReset(email: string) {
      try {
        await request("sendOobCode", { requestType: "PASSWORD_RESET", email });
      } catch (error) {
        // Do not disclose existence even if Firebase enumeration protection is off.
        if (
          !(error instanceof FirebaseAuthError) ||
          error.kind !== "credentials"
        )
          throw error;
      }
    },
    deleteUser: (uid: string) => admin.deleteUser(uid),
  };
}

/** Credentials come from GOOGLE_APPLICATION_CREDENTIALS, outside the repository. */
export function configuredFirebaseAuth() {
  const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (emulator) {
    // Local browser tests only: a loopback emulator and a demo project, never a real one.
    if (
      !/^(127\.0\.0\.1|localhost):\d+$/.test(emulator) ||
      !firebaseConfig.projectId.startsWith("demo-") ||
      process.env.NODE_ENV === "production"
    )
      throw new Error("The Auth Emulator is limited to local demo projects.");
    const name = `emulator-${firebaseConfig.projectId}`;
    const app =
      getApps().find((candidate) => candidate.name === name) ??
      initializeApp({ projectId: firebaseConfig.projectId }, name);
    const transport: typeof fetch = (url, init) =>
      fetch(
        String(url).replace(
          "https://identitytoolkit.googleapis.com",
          `http://${emulator}/identitytoolkit.googleapis.com`,
        ),
        init,
      );
    return createFirebaseAuth(getAuth(app), transport);
  }
  const name = `auth-${firebaseConfig.projectId}`;
  const app =
    getApps().find((candidate) => candidate.name === name) ??
    initializeApp(
      { projectId: firebaseConfig.projectId, credential: applicationDefault() },
      name,
    );
  return createFirebaseAuth(getAuth(app));
}

export type FirebaseAuth = ReturnType<typeof createFirebaseAuth>;
