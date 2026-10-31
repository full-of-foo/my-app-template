import { config } from "../config";

export default function Support() {
  return (
    <>
      <h1>Help & support</h1>
      <p className="lead">
        Need a hand? Email{" "}
        <a href={`mailto:${config.supportEmail}`}>{config.supportEmail}</a>.
      </p>
      <section className="panel">
        <h2>Forgot your password</h2>
        <p>
          Choose “Forgot password” and enter your username and the recovery code
          you saved when you created your account. You’ll get a new recovery
          code. We don’t collect email addresses, so support can’t reset
          passwords.
        </p>
      </section>
      <section className="panel">
        <h2>Checking sync</h2>
        <p>
          Signed-in records sync automatically while the app is open. Go to
          Settings → Account & sync to see when they last synced or to try
          again.
        </p>
      </section>
      <section className="panel">
        <h2>Moving to a new device</h2>
        <p>
          Sign in to the same account. If you used the app without an account,
          export a backup in Settings and import it on the new device.
        </p>
      </section>
    </>
  );
}
