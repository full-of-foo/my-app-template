# Email password recovery with Firebase Authentication

Optional. Without it, accounts recover with the saved recovery code. With it, people can link a
verified email and reset a forgotten password through Firebase's hosted email, which needs no
domain of your own (mail comes from `noreply@<project>.firebaseapp.com`). Firebase's free Spark
plan currently allows 150 reset emails a day; check the limits page before launch.

## How it behaves

- Usernames, user IDs and synced records never change. Linking an email is optional and needs
  the current password.
- After the address is verified and the person presses **finish setup**, Firebase becomes the
  password authority: the local password hash and recovery code stop working and other sessions
  are signed out. A Firebase password reset signs out every session.
- Installed app versions that predate the feature don't send `?protocol=firebase`; the server
  hides the Firebase flow from them.

## Set up one Firebase project per app

1. Firebase console → create a project on the Spark plan; Google Analytics off.
2. Authentication → Get started → Sign-in method → enable **Email/Password** (leave the email
   link option off).
3. Project settings → General → add a **Web** app (no Hosting). Put its `apiKey` and `projectId`
   in `server/firebase-config.ts` or the `FIREBASE_API_KEY` / `FIREBASE_PROJECT_ID` variables.
   These are public identifiers.
4. Project settings → Service accounts → generate a private key. Keep the JSON outside the
   repository, never in a `VITE_` variable, chat or screenshots. Locally, set
   `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/key.json` in `.env`. On Render, upload it as a
   **secret file** and point the variable at `/etc/secrets/<file name>`.
5. Set `FIREBASE_AUTH_ENABLED=true` and deploy.
6. Test with a real mailbox: link an email in Settings, open the verification email, finish
   setup, then use **Forgot password** and the reset email.

## Tests

- `npm run test:server` — route tests with a fake provider.
- Emulator integration (needs Java 21):
  `RUN_FIREBASE_EMULATOR=1 npx firebase-tools emulators:exec --only auth --project demo-auth-migration "npx vitest run --config vitest.server.config.ts server/firebase-emulator.test.ts"`

The emulator is only accepted for loopback hosts and `demo-` project IDs.
