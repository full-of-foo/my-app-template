# Verification at extraction — 31 October 2026

All checks used synthetic data in disposable local databases. No production services were contacted.

| Check                                                                                                                                                 | Where                                           | Result                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------- |
| TypeScript, ESLint, Prettier                                                                                                                          | Linux workspace and macOS                       | Passed                                                  |
| Frontend unit and journey tests (Vitest, jsdom)                                                                                                       | Linux and macOS                                 | 22 passed; coverage thresholds passed (≈85% statements) |
| Backend tests against real PostgreSQL, including a process restart                                                                                    | Linux (PostgreSQL 16) and macOS (PostgreSQL 17) | 14 passed                                               |
| `npm run rename` against a generated native layout                                                                                                    | Vitest                                          | Passed                                                  |
| Playwright: account lifecycle (register, sync, recover on a second browser profile, delete) and offline device-only use, with axe accessibility scans | Chromium desktop and Chromium phone emulation   | 4 passed                                                |
| iOS Debug build (Xcode, iOS 27.2 simulator)                                                                                                           | macOS                                           | Passed                                                  |
| Android Debug build and lint (Gradle, API 37)                                                                                                         | macOS                                           | Passed                                                  |
| `.maestro/smoke.yaml` on the installed apps: welcome, device-only setup, note editor, persistence across restart, Settings, dark appearance           | iPhone 18 Pro Max simulator and API 37 emulator | Passed on both                                          |

Findings fixed during verification:

- Long unbroken usernames overflowed narrow screens and let the editor toolbar intercept taps. Headings and text now wrap anywhere.
- Note list rows centred their text on iOS; rows now align left.
- `npm run check` ran backend tests before the build; the static-file test needs `dist`, so the build now runs first.

Not covered yet: Firefox and WebKit browser projects (run `npm run test:e2e` without `PLAYWRIGHT_CHROMIUM_PATH`), native account sign-in automation (the Settings form sits partly under the iOS keyboard in Maestro; account flows are covered by the browser tests and use the same code), Release-signed builds, and VoiceOver/TalkBack on hardware.
