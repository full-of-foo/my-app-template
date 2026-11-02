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
          Go to Settings → Account &amp; sync, choose “Forgot password” and
          enter your email. Open the link we send to choose a new password, then
          sign in. If you created your account with a username before email
          sign-in, choose “Signed up with a username?” and use the recovery code
          you saved; you’ll then be asked to add your email.
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
