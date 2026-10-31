# New app checklist

Work through this after `npm run rename`. Nothing here is optional for a store release.

## Identity

- [ ] `app.config.json`: name, short name, tagline, description, `appId`, `urlScheme`, `productionOrigin`, colours, publisher, support email.
- [ ] Colours in `src/styles.css` (`:root` and `[data-theme="dark"]`); check contrast in both themes.
- [ ] Icons: replace `public/icon.svg`, `public/icon-512.png` and `assets/icon.png` (1024 × 1024), then `npx @capacitor/assets generate` to regenerate native icons and splash screens.
- [ ] `render.yaml` service name; `LICENSE` holder if you're not using MIT for the product.

## Product

- [ ] Replace `src/features/notes` with your feature. Update `documentSchema` in `src/data.ts`, the Dexie stores in `src/storage.ts` (add a new `version()` rather than editing version 1 once released) and the sample data.
- [ ] Rewrite the landing copy in `src/pages/Welcome.tsx` and the Home screen.
- [ ] Update tabs and titles in `src/App.tsx`.
- [ ] Keep tests green: replace the notes assertions in `tests/` and `e2e/` with your feature's.

## Privacy and support

- [ ] Rewrite `src/pages/Privacy.tsx` for what your product actually collects, who processes it (hosting, database provider) and how deletion works. The template text is a starting point, not legal advice.
- [ ] Update `src/pages/Support.tsx`; make sure the support email is monitored.
- [ ] If your product touches health, finance or children's data, review the store rules for that category before building.

## Deployment

- [ ] Create a PostgreSQL database and set `DATABASE_URL` as a secret. Never commit it.
- [ ] Deploy; confirm `/api/health` and that `APP_ORIGIN` (or Render's hostname) is HTTPS.
- [ ] Set `productionOrigin` to the deployed URL before building release mobile apps.

## Stores

- [ ] Apple: App ID, signing, App Store Connect record, privacy label matching the Privacy page, age rating, screenshots from the real app, reviewer access (a test account with sample data), and in-app account deletion (already included).
- [ ] Google Play: app record, Play App Signing, Data safety form, content rating, app access instructions, account deletion URL (host a page that explains in-app deletion).
- [ ] Bump `MARKETING_VERSION` (iOS) / `versionName` and `versionCode` (Android) for every upload.
- [ ] Test on real devices with VoiceOver and TalkBack before submitting.
