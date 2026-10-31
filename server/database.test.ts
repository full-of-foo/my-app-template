import { it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createPool, migrate } from "./database";
const connection =
  process.env.TEST_DATABASE_URL ??
  "postgresql://app:app_local_only@127.0.0.1:54330/app_test";
it("handles idle connection errors without exposing database details or crashing", async () => {
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  const pool = createPool(connection);
  try {
    pool.emit("error", new Error("synthetic idle disconnect"));
    expect(logger).toHaveBeenCalledWith(
      "Database connection interrupted; retrying on the next request.",
    );
    expect((await pool.query("SELECT 1 as ready")).rows[0].ready).toBe(1);
  } finally {
    logger.mockRestore();
    await pool.end();
  }
});
it("rolls back a failed schema migration and releases its connection", async () => {
  const admin = createPool(connection);
  const schema = `migration_${randomUUID().replaceAll("-", "")}`;
  const configured = new URL(connection);
  configured.searchParams.set("options", `-c search_path=${schema}`);
  const isolated = createPool(configured.toString());
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`CREATE TABLE ${schema}.users(id text PRIMARY KEY)`);
    await expect(migrate(isolated)).rejects.toThrow();
    const state = await admin.query(
      "SELECT to_regclass($1) as migrations,to_regclass($2) as sessions,to_regclass($3) as users",
      [`${schema}.schema_migrations`, `${schema}.sessions`, `${schema}.users`],
    );
    expect(state.rows[0].migrations).toBeNull();
    expect(state.rows[0].sessions).toBeNull();
    expect(state.rows[0].users).not.toBeNull();
    expect(
      (await isolated.query("SELECT 1 as released")).rows[0].released,
    ).toBe(1);
  } finally {
    await isolated.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
