# Architecture

```
app.config.json          product identity (name, IDs, colours, origin, support email)
server/                  Express API: auth, sessions, one JSON document per account
  migrations/NNN_*.sql   applied in order at startup, inside one transaction
src/
  config.ts              validated app.config.json
  data.ts                the synced document schema (preferences + your collections)
  storage.ts             Dexie stores: device-only, one per account, sample demo
  sync.ts                revisioned upload/download with conflict detection
  account-api.ts         typed API client
  mobile.ts              web/native transport, file export, Android leave-app
  useAppState.ts         app-wide state and actions
  App.tsx                shell, navigation, Back handling
  pages/                 Welcome (landing), Home, Settings, Privacy, Support
  components/            AccountForm, AccountPanel (Account & sync)
  features/notes/        example feature — replace it
ios/, android/           Capacitor native projects
```

## Data and sync

Each person's data is one document (`src/data.ts`) validated with Zod on both client and server. The server stores it as `jsonb` with a `revision` counter.

- Every local change marks the store dirty and bumps a `generation`.
- Sync reads the cloud copy. If the device is clean, it downloads. If dirty and the revisions match, it uploads with optimistic concurrency (`PUT` with the expected revision).
- If another device changed the cloud copy first, the app shows **Keep this device's copy / Use the other copy**. Nothing is overwritten silently.
- Sync runs after edits, on reconnect, every 60 s while open and when the native app resumes. It never claims to run while the app is closed.
- Routine status lives in Settings → Account & sync. Banners appear only when action is needed (sign in again, conflict, rejected request).

A document-per-account model keeps the template simple and suits personal apps with modest data. If your product needs large or shared datasets, replace `documents` with normal tables and per-record sync.

## Accounts

Usernames are 3–40 lowercase letters, numbers or underscores; passwords 12–128 characters, hashed with scrypt. Registration returns a 64-character recovery code (stored only as a SHA-256 hash). Recovery rotates the code and ends all other sessions. Sessions are random 32-byte tokens in an HttpOnly cookie (`__Host-session`, `Secure`, in production), stored hashed, 30-day sliding expiry. Account deletion requires the password and cascades sessions and data.

Write requests must come from `APP_ORIGIN` and be JSON. Helmet sets a strict CSP; rate limits apply to the API and, more tightly, to auth.

## Native

The installed apps bundle the web build (no remote web content). API calls go through `CapacitorHttp` with the platform cookie store. Release bundles require an HTTPS API origin; `mobile-test` builds allow loopback HTTP for simulators only.

First-use routing and optional verified email recovery: [ONBOARDING_EMAIL_RECOVERY.md](ONBOARDING_EMAIL_RECOVERY.md).
