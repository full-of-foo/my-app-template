import { createPool, migrate } from "./database";
import { createApp } from "./app";
import { config } from "../src/config";
const pool = createPool();
await migrate(pool);
const production = process.env.NODE_ENV === "production";
const origin =
  process.env.APP_ORIGIN ??
  (process.env.RENDER_EXTERNAL_HOSTNAME
    ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`
    : "http://localhost:5173");
if (production && !origin.startsWith("https://"))
  throw Error("APP_ORIGIN must be an HTTPS origin in production.");
const app = createApp(pool, {
  origin,
  production,
  staticDir: production ? "dist" : undefined,
});
const server = app.listen(
  Number(process.env.PORT ?? 3001),
  production ? "0.0.0.0" : "127.0.0.1",
  () => console.log(`${config.name} server ready`),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => void pool.end().then(() => process.exit(0))),
  );
