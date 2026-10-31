# Template extraction

Extracted on 31 October 2026 from herPal (private), commit `7bd2474`, as Phase 4 of its product plan. The template is a **clean copy**: no herPal Git history, production configuration, credentials, signing material, store records, user data or herPal branding.

## Kept and generalised

| From herPal                                                                     | In the template                                          |
| ------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Express server, Helmet CSP, origin/JSON checks, rate limits                     | `server/app.ts`, unchanged in behaviour                  |
| scrypt passwords, recovery codes, hashed session tokens                         | `server/security.ts`, unchanged                          |
| Transactional migrations                                                        | Now discovers `migrations/NNN_*.sql` automatically       |
| Revisioned document sync with conflict detection                                | `src/sync.ts`; adds “keep this device's copy” resolution |
| Separate device / per-account / demo stores                                     | `src/storage.ts`; demo is a temporary Dexie store        |
| Quiet sync, status in Settings, actionable banners only (herPal Phase 1)        | `src/useAppState.ts`, `AccountPanel`                     |
| Native toolbar, full-height editor, platform targets, Android Back (Phases 2–3) | `src/App.tsx`, `NoteEditor`, `styles.css`                |
| Native transport, private-cache export, lifecycle listeners                     | `src/mobile.ts`, `src/NativeLifecycle.tsx`               |

## Removed

Cycle tracking, symptoms, predictions, insights and articles; partner invitations, sharing and alerts; health-specific privacy and store text; herPal icons, IDs, domain and deep links; Fastlane lanes and store workflows; Maestro flows tied to herPal screens.

## New

`app.config.json` as the single identity source, `npm run rename` for native IDs, a landing page, a Home screen, Support page, the notes example, and the docs in this folder.

## Getting template fixes into derived apps

Derived apps are independent copies. To adopt a template fix: note the template commit, then `git remote add template https://github.com/full-of-foo/my-app-template.git && git fetch template` in the derived app and cherry-pick or port the change. Shared code that keeps drifting (auth, sync) could later become a package; that isn't justified until at least two derived apps exist.

## Verification at extraction

See the repository's first commit message and `docs/VERIFICATION.md`.
