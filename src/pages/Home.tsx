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
          ? `Hello, ${app.user.username}`
          : `Welcome to ${config.shortName}`}
      </h1>
      <p className="lead">{config.tagline}</p>
      <section className="panel" aria-labelledby="summary-title">
        <h2 id="summary-title">Your notes</h2>
        <p>
          {count === 0
            ? "You haven’t written anything yet."
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
          <Link className="button secondary" to="/notes">
            View all notes
          </Link>
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
