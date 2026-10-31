// Local production-asset verification; real API and database, development-only HTTP cookie.
import { createPool, migrate } from "./database";
import { createApp } from "./app";
import { config } from "../src/config";
const pool = createPool();
await migrate(pool);
const server = createApp(pool, {
  origin: "http://localhost:4173",
  // Browser CI uses a disposable database and makes many requests from one IP.
  // Production rate limits are tested separately and always stay enabled.
  limits: !process.env.CI,
  staticDir: "dist",
}).listen(4173, "127.0.0.1", () =>
  console.log(
    `${config.name} production assets and API: http://localhost:4173`,
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => void pool.end().then(() => process.exit(0))),
  );
