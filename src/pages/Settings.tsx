import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Upload } from "lucide-react";
import { config } from "../config";
import { exportFile, isNative } from "../mobile";
import { load, parseImport } from "../storage";
import type { AppDocument } from "../data";
import AccountPanel from "../components/AccountPanel";
import type { AppState } from "../useAppState";

export default function Settings({ app }: { app: AppState }) {
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<AppDocument | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const demo = app.space?.kind === "demo";
  const prefs = app.doc.preferences;
  const report = async (task: () => Promise<void>, done: string) => {
    try {
      await task();
      setMessage(done);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong.");
    }
  };
  return (
    <>
      <h1>Settings</h1>
      <p className="lead">Make {config.shortName} work the way you like.</p>
      <AccountPanel app={app} />
      <section className="panel" aria-labelledby="appearance-title">
        <h2 id="appearance-title">Appearance</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={prefs.theme === "dark"}
            onChange={(e) =>
              void app.setPrefs({
                ...prefs,
                theme: e.target.checked ? "dark" : "light",
              })
            }
          />
          Dark appearance
        </label>
      </section>
      <section className="panel" aria-labelledby="data-title">
        <h2 id="data-title">Your data</h2>
        <p>
          A backup is a JSON file with everything you’ve saved. Keep it private.{" "}
          {isNative() ? "You choose where to save or share it." : ""}
        </p>
        <div className="button-row">
          <button
            className="secondary"
            onClick={() =>
              void report(async () => {
                const doc = await load();
                await exportFile(
                  `${config.shortName.toLowerCase().replace(/\W+/g, "-")}-backup.json`,
                  JSON.stringify(doc, null, 2),
                  "application/json",
                );
              }, "Backup ready.")
            }
          >
            <Download size={16} aria-hidden /> Export backup
          </button>
          <button
            className="secondary"
            disabled={demo}
            onClick={() => file.current?.click()}
          >
            <Upload size={16} aria-hidden /> Import backup
          </button>
          <input
            ref={file}
            hidden
            type="file"
            accept="application/json,.json"
            aria-label="Backup file"
            onChange={async (e) => {
              const chosen = e.target.files?.[0];
              e.target.value = "";
              if (!chosen) return;
              try {
                setPreview(parseImport(await chosen.text()));
                setMessage("");
              } catch (err) {
                setMessage(
                  err instanceof Error ? err.message : "Could not read file.",
                );
              }
            }}
          />
        </div>
        {preview && (
          <div className="inset">
            <p>
              This backup has {preview.notes.length} note
              {preview.notes.length === 1 ? "" : "s"}. Notes with the same ID
              will be replaced; others are kept.
            </p>
            <div className="button-row">
              <button className="secondary" onClick={() => setPreview(null)}>
                Cancel
              </button>
              <button
                className="primary"
                onClick={() =>
                  void report(async () => {
                    await app.importDocument(preview);
                    setPreview(null);
                  }, "Backup imported.")
                }
              >
                Import
              </button>
            </div>
          </div>
        )}
        <button
          className="danger"
          disabled={demo}
          onClick={() => setConfirmErase(true)}
        >
          Delete all my data
        </button>
        {confirmErase && (
          <div className="inset" role="alertdialog" aria-labelledby="erase">
            <h3 id="erase">Delete all data?</h3>
            <p>
              {app.user
                ? "This removes all notes and preferences from your account and this device. Your account stays open."
                : "This removes all notes and preferences saved on this device."}{" "}
              Downloaded backups are not affected. This cannot be undone.
            </p>
            <div className="button-row">
              <button
                className="secondary"
                onClick={() => setConfirmErase(false)}
              >
                Cancel
              </button>
              <button
                className="danger"
                onClick={() =>
                  void report(async () => {
                    await app.eraseAll();
                    setConfirmErase(false);
                  }, "All data deleted.")
                }
              >
                Delete everything
              </button>
            </div>
          </div>
        )}
        {message && <p role="status">{message}</p>}
      </section>
      <section className="panel" aria-labelledby="about-title">
        <h2 id="about-title">About</h2>
        <p>
          {config.name} · published by {config.publisher}
        </p>
        <ul className="links">
          <li>
            <Link to="/privacy">Privacy</Link>
          </li>
          <li>
            <Link to="/support">Help & support</Link>
          </li>
        </ul>
      </section>
    </>
  );
}
