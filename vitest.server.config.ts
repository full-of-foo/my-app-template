import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
// Local developers keep TEST_DATABASE_URL in .env; CI passes it directly.
if (existsSync(".env")) process.loadEnvFile(".env");
export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage-server",
      include: ["server/app.ts", "server/database.ts", "server/security.ts"],
      thresholds: {
        statements: 90,
        functions: 90,
        lines: 90,
        branches: 85,
        "server/database.ts": {
          statements: 90,
          functions: 90,
          lines: 90,
          branches: 85,
        },
      },
    },
  },
});
