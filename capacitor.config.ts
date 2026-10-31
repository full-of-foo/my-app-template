import type { CapacitorConfig } from "@capacitor/cli";
import app from "./app.config.json";
const config: CapacitorConfig = {
  appId: app.appId,
  appName: app.name,
  webDir: "dist-mobile",
  loggingBehavior: "none",
  server: { androidScheme: "https" },
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
  ios: { contentInset: "never", preferredContentMode: "mobile" },
};
export default config;
