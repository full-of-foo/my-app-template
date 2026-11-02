import { Link } from "react-router-dom";
import { config } from "../config";
import type { AppState } from "../useAppState";

/** Minimal signed-in/device home. Replace with your product's main screen. */
export default function Home({
  app,
  onNew,
}: {
  app: AppState;
  onNew: () => void;
}) {
  const count = app.doc.notes.length;
  const latest = app.doc.notes[0];
  return (
    <>
      <h1>
        {app.user
          ? app.user.username
            ? `Hello, ${app.user.username}`
            : "Hello"
          : `Welcome to ${config.shortName}`}
      </h1>
      <p className="lead">{config.tagline}</p>
      <section className="panel" aria-labelledby="summary-title">
        <h2 id="summary-title">
          {count === 0 ? "Create your first note" : "Your notes"}
        </h2>
        <p>
          {count === 0
            ? "Capture an idea, a reminder or something you want to remember. Your note will be here when you return."
            : `You have ${count} note${count === 1 ? "" : "s"}.`}
          {latest && (
            <>
              {" "}
              Latest: <strong>{latest.title}</strong>
            </>
          )}
        </p>
        <div className="button-row">
          <button className="primary" onClick={onNew}>
            Write a note
          </button>
          {count > 0 && (
            <Link className="button secondary" to="/notes">
              View all notes
            </Link>
          )}
        </div>
      </section>
      {app.space?.kind === "device" && (
        <p className="muted">
          Saved on this device only.{" "}
          <Link to="/settings">Create an account</Link> to use your data on
          other devices.
        </p>
      )}
    </>
  );
}
