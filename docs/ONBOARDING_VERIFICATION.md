# First-use release verification

1 November 2026. Local checks; hosted CI is not relied upon.

- Frontend: 26 tests passed; configured coverage thresholds passed.
- Backend: 18 tests passed with disposable local PostgreSQL data, including verification before recovery, purpose-bound codes, expiry, simultaneous reuse, request limits, session/recovery-code invalidation, email removal and sender failure.
- Browser suite: 8 passed, across Chromium, phone viewport, Firefox and WebKit. Account, offline, accessibility and persistence journeys retained.
- Additional browser walkthrough: signup from Settings → dashboard → first record → verify email → sign out → emailed-code reset → sign in → reload. Synthetic emails captured locally; no actual mail sent.
- iOS simulator build and installed signup/dashboard/editor/recovery-settings/relaunch journey passed.
- Android debug build, lint and unit-test tasks plus the same installed journey passed.
- Production web/mobile bundles, TypeScript, lint, formatting and diff checks performed before release.

Local screenshot/video gallery: `/Users/t/dev/herPal/reports/onboarding/index.html`. Native baselines preserve previous synthetic test state; after screenshots use fresh synthetic accounts, so routes and content can differ. Additional native recordings cover the walkthroughs; the template iOS walkthrough has screenshots and logs only.

Resend integration is prepared but not connected to a verified production sender. No live delivery, store submission, store metadata change or physical-device accessibility claim is made. Complete sender and secret setup in [ONBOARDING_EMAIL_RECOVERY.md](ONBOARDING_EMAIL_RECOVERY.md) before enabling email recovery.
