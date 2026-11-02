import { config } from "../config";

// TEMPLATE TEXT: rewrite for your product before release (see docs/NEW_APP_CHECKLIST.md).
export default function Privacy() {
  return (
    <>
      <h1>Privacy</h1>
      <p className="lead">How {config.name} handles your information.</p>
      <section className="panel">
        <h2>Without an account</h2>
        <p>
          Everything you save stays on this device. Nothing is sent to our
          servers. If you clear this app’s storage or lose the device, those
          records cannot be recovered, so export a backup from Settings.
        </p>
      </section>
      <section className="panel">
        <h2>With an account</h2>
        <p>
          We store your email address and the records you save, so you can use
          them on your other devices. Google Firebase Authentication handles
          sign-in: it stores your email and a protected hash of your password
          and sends verification and password-reset emails. Your records are
          never sent to Firebase. Data is sent over HTTPS and kept in a database
          run by our hosting providers. Your sign-in lasts 30 days and renews
          while you use the app. Older accounts created with a username are
          asked to add an email the next time they sign in.
        </p>
      </section>
      <section className="panel">
        <h2>Deleting your account</h2>
        <p>
          Deleting your account in Settings removes your records from our
          database and deletes your Firebase sign-in.
        </p>
      </section>
      <section className="panel">
        <h2>What we don’t do</h2>
        <p>
          No advertising, no tracking and no analytics. We don’t sell your data
          or share it for advertising. The sample data never leaves your device.
        </p>
      </section>
      <section className="panel">
        <h2>Deleting your data</h2>
        <p>
          In Settings you can delete all your data, or delete your account and
          everything synced with it. Backups you downloaded are yours to delete.
        </p>
      </section>
      <p className="muted">
        Questions? Email{" "}
        <a href={`mailto:${config.supportEmail}`}>{config.supportEmail}</a>.
      </p>
    </>
  );
}
