import { Pool } from "pg";
import { readdir, readFile } from "node:fs/promises";
export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString)
    throw Error("DATABASE_URL is required. See .env.example.");
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 10000,
  });
  pool.on("error", () =>
    console.error(
      "Database connection interrupted; retrying on the next request.",
    ),
  );
  return pool;
}
const migrations = new URL("./migrations/", import.meta.url);
/**
 * Applies every `NNN_name.sql` file in order inside one transaction.
 * Migrations must be idempotent and additive; never edit an applied file.
 */
export async function migrate(pool: Pool) {
  const files = (await readdir(migrations))
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(762410)");
    for (const name of files)
      await client.query(await readFile(new URL(name, migrations), "utf8"));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
