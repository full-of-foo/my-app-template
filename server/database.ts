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
export async function migrate(pool: Pool) {
  const directory = new URL("./migrations/", import.meta.url);
  const files = (await readdir(directory))
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(762409)");
    const exists = (
      await client.query("SELECT to_regclass('schema_migrations') AS name")
    ).rows[0].name;
    const applied = new Set<number>(
      exists
        ? (
            await client.query("SELECT version FROM schema_migrations")
          ).rows.map((row) => row.version)
        : [],
    );
    for (const name of files) {
      if (!applied.has(Number(name.slice(0, 3))))
        await client.query(await readFile(new URL(name, directory), "utf8"));
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
