import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import app from "./app.config.json";

export default defineConfig(({ mode }) => ({
  define: {
    "import.meta.env.VITE_API_ORIGIN": JSON.stringify(
      process.env.MOBILE_API_ORIGIN || app.productionOrigin,
    ),
  },
  server: { proxy: { "/api": "http://127.0.0.1:3001" } },
  build: { outDir: mode.startsWith("mobile") ? "dist-mobile" : "dist" },
  plugins: [
    {
      name: "app-identity",
      transformIndexHtml: (html: string) =>
        html
          .replaceAll("%APP_NAME%", app.name)
          .replaceAll("%APP_DESCRIPTION%", app.description)
          .replaceAll("%APP_THEME_COLOR%", app.themeColor),
    },
    {
      name: "mobile-content-security-policy",
      transformIndexHtml: () =>
        mode.startsWith("mobile")
          ? [
              {
                tag: "meta",
                attrs: {
                  "http-equiv": "Content-Security-Policy",
                  content:
                    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
                },
                injectTo: "head" as const,
              },
            ]
          : [],
    },
    react(),
    !mode.startsWith("mobile") &&
      VitePWA({
        registerType: "prompt",
        injectRegister: "script",
        manifest: {
          name: app.name,
          short_name: app.shortName,
          description: app.description,
          theme_color: app.themeColor,
          background_color: app.backgroundColor,
          display: "standalone",
          icons: [
            { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/api\//],
          cleanupOutdatedCaches: true,
        },
      }),
  ],
  test: {
    maxWorkers: 2,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/main.tsx"],
      thresholds: { statements: 80, functions: 75, lines: 80, branches: 70 },
    },
  },
}));
