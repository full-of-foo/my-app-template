# First use and email recovery

Updated 1 November 2026.

## First-use contract

After explicit account creation, sign-in or recovery-code acknowledgement, open the dashboard rather than leaving the user in Settings. Preserve account/device/demo isolation and existing records. Fresh dashboards offer a clear first action: create a note. Replace this example with your product’s first useful action. Returning users retain their records and normal navigation.

## Recovery contract

Username/password and saved recovery codes remain compatible. Users may add a recovery email during code acknowledgement or in Settings. Adding, replacing or removing an address requires the current password. An address becomes usable only after its owner enters the emailed verification code; the old verified address remains active until replacement is verified. No email is required for device-only use.

Forgot password offers email recovery and the existing saved-code fallback. Email resets require the username and matching verified address. Responses do not reveal whether an account exists. Codes are cryptographically random, stored hashed, purpose-bound, valid for 15 minutes and single use. Reset requests are limited to three per account per hour, in addition to IP limits. Reset succeeds atomically, revokes existing sessions, invalidates other email challenges and replaces the saved recovery code. Users save that replacement and sign in normally; no automatic login occurs. Account deletion cascades to recovery metadata. No app records are included in emails.

## Free integration setup

The implementation uses Resend's transactional API with no new SDK dependency. As checked on 1 November 2026, the free plan has a 100-email daily limit; recheck https://resend.com/pricing before enabling. No paid service has been purchased or provisioned.

1. Create a free Resend account and verify a sender domain you control using its DNS instructions. A public web-host subdomain does not establish ownership of an email-sending domain.
2. Create a sending API key. In each deployed server's secret environment set `RESEND_API_KEY` and `RECOVERY_EMAIL_FROM` (for example `Your App <recovery@your-domain.example>`). Never prefix these with VITE_, place them in the client config, commit them or paste them into chat.
3. Restart/redeploy that server. Missing configuration keeps email recovery visibly unavailable and leaves recovery codes usable. Accounts are never blocked by email configuration.
4. Verify a controlled mailbox in Settings, request a reset, check delivery/spam, reset and confirm old sessions are signed out. Disable email-provider click/open tracking; these messages use codes, not tracking links. Configure provider usage alerts and avoid automatic paid upgrades.

The request endpoint responds before provider delivery to avoid exposing account existence through delivery timing. A failed reset-email delivery is logged without addresses or codes; the user can retry within the quota or use a saved code. Verification delivery failures are reported and the failed challenge is removed. Delivery is not a durable queue: a server restart during dispatch may lose a message. No actual delivery is claimed by local tests, which capture synthetic messages only.

## Release constraints

Web and API may be released together. No mobile-store submission or upload is authorized. Before a future mobile release with email recovery enabled, update Apple/Google privacy declarations for optional email/contact information used for app functionality, linked to an account, not tracking. Review provider retention and operational notices for the actual deployment. Existing submitted builds remain unchanged.

## Sources

- [OWASP forgot-password guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
- [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email)
- [Resend pricing](https://resend.com/pricing)
