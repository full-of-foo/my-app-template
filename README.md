# My App Template

A starting point for small, privacy-respecting products that run on the **web, iPhone and Android** from one codebase, with an optional **account backend**.

- **Offline-first.** Records live on the device (IndexedDB) and work without a connection.
- **Optional accounts.** Username + password, a one-time recovery code instead of email, 30-day sessions, quiet background sync with conflict detection.
- **Three ways in.** Create an account, use on this device only, or explore sample data that never leaves the device.
- **Settings that stores expect.** Account & sync status, appearance, backup export/import, delete all data, and in-app account deletion.
- **One example feature** (`src/features/notes`) to replace with your own.
- **Native shells** via Capacitor 8: page toolbar, bottom tabs, full-height editor with Close/Save, 44 pt iOS and 48 dp Android touch targets, Android Back that returns to Home then leaves the app.

Stack: React 19 + Vite, Express 5 + PostgreSQL, Zod, Dexie, Capacitor. Extracted from a production app; see [docs/TEMPLATE_EXTRACTION.md](docs/TEMPLATE_EXTRACTION.md).

## Start a new product

```bash
git clone https://github.com/full-of-foo/my-app-template.git quit-buddy
cd quit-buddy && rm -rf .git && git init
npm ci
npm run rename -- --name "Quit Buddy" --id com.yourcompany.quitbuddy
```

Then work through [docs/NEW_APP_CHECKLIST.md](docs/NEW_APP_CHECKLIST.md): identity, icons, privacy text, your data model, deployment and store setup.

## Run locally

Requires Node 22 and Docker (or any PostgreSQL 16+).

```bash
cp .env.example .env
docker compose up -d db
npm run dev          # web on http://localhost:5173, API on :3001
```

## Check everything

```bash
npm run check        # typecheck, lint, format, frontend coverage, backend tests, build
npm run test:e2e     # Playwright: account lifecycle, offline device use, accessibility scans
```

`npm run test:server` uses `TEST_DATABASE_URL` from `.env`.

## Mobile

```bash
npm run mobile:ios       # builds, syncs and opens Xcode
npm run mobile:android   # builds, syncs and opens Android Studio
```

Release builds talk to `productionOrigin` from `app.config.json` over HTTPS. For a simulator against your local API:

```bash
MOBILE_API_ORIGIN=http://127.0.0.1:3001 npm run build:mobile:test && npx cap copy    # iOS simulator
MOBILE_API_ORIGIN=http://10.0.2.2:3001 npm run build:mobile:test && npx cap copy     # Android emulator
```

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Deploy

`render.yaml` deploys the web app and API as one Node service on [Render](https://render.com). Set `DATABASE_URL` as a secret (any managed PostgreSQL works). Migrations in `server/migrations` run on startup.

## Licence

MIT. See [LICENSE](LICENSE).
