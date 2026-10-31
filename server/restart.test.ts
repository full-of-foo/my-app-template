import { it, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createPool } from "./database";
import { emptyDocument } from "../src/data";
import { newNote } from "../src/features/notes/model";
const base = "http://localhost:4399";
const connection =
  process.env.TEST_DATABASE_URL ??
  "postgresql://app:app_local_only@127.0.0.1:54330/app_test";
async function start() {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "server/index.ts"],
    {
      env: {
        ...process.env,
        DATABASE_URL: connection,
        PORT: "4399",
        APP_ORIGIN: base,
        NODE_ENV: "test",
      },
      stdio: "ignore",
    },
  );
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null)
      throw Error("Test account server exited during startup.");
    try {
      if ((await fetch(`${base}/api/health`)).ok) return child;
    } catch {
      /* Waiting for the test server's listening socket. */
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill();
  throw Error("Test account server did not become ready.");
}
async function stop(child: ChildProcess) {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
}
it("retains accounts, sessions and records after a real Node process restart", async () => {
  let child = await start();
  const username = `restart_${Date.now()}`,
    password = "unique-restart-test-password";
  const headers = { "Content-Type": "application/json", Origin: base };
  try {
    const registration = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers,
      body: JSON.stringify({ username, password }),
    });
    expect(registration.status).toBe(201);
    const cookie = registration.headers.get("set-cookie")!.split(";")[0];
    const data = {
      ...emptyDocument(),
      notes: [newNote("Restart", "synthetic process restart observation")],
    };
    expect(
      (
        await fetch(`${base}/api/data`, {
          method: "PUT",
          headers: { ...headers, Cookie: cookie },
          body: JSON.stringify({ revision: 0, data }),
        })
      ).ok,
    ).toBe(true);
    const firstPID = child.pid;
    await stop(child);
    child = await start();
    expect(child.pid).not.toBe(firstPID);
    const session = await (
      await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookie } })
    ).json();
    expect(session.user.username).toBe(username);
    const restored = await (
      await fetch(`${base}/api/data`, { headers: { Cookie: cookie } })
    ).json();
    expect(restored).toEqual({ revision: 1, data });
  } finally {
    await stop(child);
    const pool = createPool(connection);
    await pool.query("DELETE FROM users WHERE username=$1", [username]);
    await pool.end();
  }
});
