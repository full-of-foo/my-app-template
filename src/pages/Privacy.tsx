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
          Your username, a protected hash of your password and recovery code,
          and the records you save are stored on our servers so you can use them
          on other devices. We never store your password itself. Your sign-in
          lasts 30 days and renews while you use the app.
        </p>
      </section>
      <section className="panel">
        <h2>What we don’t do</h2>
        <p>
          No advertising, no tracking and no analytics. We don’t sell or share
          your data. The sample data never leaves your device.
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
