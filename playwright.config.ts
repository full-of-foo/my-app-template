import { defineConfig, devices } from "@playwright/test";
// Set PLAYWRIGHT_CHROMIUM_PATH to use an already-installed Chromium.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const launchOptions = executablePath ? { executablePath } : {};
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  use: { baseURL: "http://localhost:4173", trace: "retain-on-failure" },
  timeout: 60000,
  webServer: {
    command: "npm run build && npm run preview",
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions },
    },
    { name: "phone", use: { ...devices["Pixel 7"], launchOptions } },
    ...(executablePath
      ? []
      : [
          { name: "firefox", use: { ...devices["Desktop Firefox"] } },
          { name: "webkit", use: { ...devices["iPhone 15"] } },
        ]),
  ],
});
