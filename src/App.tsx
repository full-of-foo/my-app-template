import { useEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  ChevronLeft,
  Home as HomeIcon,
  NotebookPen,
  Plus,
  Settings as SettingsIcon,
} from "lucide-react";
import { config } from "./config";
import { isNative, leaveApp } from "./mobile";
import { useAppState } from "./useAppState";
import { newNote, type Note } from "./features/notes/model";
import NotesPage from "./features/notes/NotesPage";
import NoteEditor from "./features/notes/NoteEditor";
import Welcome from "./pages/Welcome";
import Home from "./pages/Home";
import Settings from "./pages/Settings";
import Privacy from "./pages/Privacy";
import Support from "./pages/Support";

const tabs = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/notes", label: "Notes", icon: NotebookPen },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];
const titles: Record<string, string> = {
  "/": "Home",
  "/notes": "Notes",
  "/settings": "Settings",
  "/privacy": "Privacy",
  "/support": "Help & support",
};
/** Detail pages and the parent they return to. */
const parents: Record<string, string> = {
  "/privacy": "/settings",
  "/support": "/settings",
};

export default function App() {
  const app = useAppState();
  const location = useLocation();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<{ note: Note; isNew: boolean }>();
  const guard = useRef<() => boolean>(() => true);
  const path = location.pathname;
  const parent = parents[path];

  useEffect(() => {
    document.documentElement.dataset.theme = app.doc.preferences.theme;
  }, [app.doc.preferences.theme]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);

  // Android Back: editor → detail parent → Home → leave the app.
  useEffect(() => {
    const back = () => {
      if (editing) {
        if (guard.current()) setEditing(undefined);
      } else if (parent) navigate(parent);
      else if (path !== "/" && app.space) navigate("/");
      else void leaveApp();
    };
    window.addEventListener("app:back", back);
    return () => window.removeEventListener("app:back", back);
  }, [editing, parent, path, navigate, app.space]);

  if (!app.ready)
    return (
      <p className="loading" role="status">
        Opening {config.shortName}…
      </p>
    );
  if (app.error)
    return (
      <p className="error page" role="alert">
        {app.error}
      </p>
    );

  const startNew = () =>
    setEditing({
      note: { ...newNote("draft"), title: "" },
      isNew: true,
    });
  const shell = (content: React.ReactNode) => (
    <div className={`shell${isNative() ? " native" : ""}`}>
      <header className="topbar">
        {parent ? (
          <Link
            className="back"
            to={parent}
            aria-label={`Back to ${titles[parent]}`}
          >
            <ChevronLeft aria-hidden /> {titles[parent]}
          </Link>
        ) : (
          <Link className="brand" to="/">
            {config.shortName}
          </Link>
        )}
        <span className="toolbar-title" aria-hidden>
          {titles[path] ?? ""}
        </span>
        <nav aria-label="Main navigation" className="tabs">
          {tabs.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end>
              <Icon aria-hidden size={22} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        {app.space && (
          <button
            className="text strong new"
            onClick={startNew}
            aria-label="New note"
          >
            <Plus aria-hidden size={20} /> New
          </button>
        )}
      </header>
      {app.space?.kind === "demo" && (
        <div className="banner demo">
          <span>Sample data · changes are temporary and never uploaded.</span>
          <button
            className="text"
            onClick={() => void app.leaveDemo().then(() => navigate("/"))}
          >
            Leave sample
          </button>
        </div>
      )}
      {app.sync.attention && (
        <div className="banner attention" role="alert">
          <span>{app.sync.attention}</span>
          {app.sync.conflict ? (
            <span className="button-row">
              <button
                className="secondary"
                onClick={() => void app.resolveConflict("device")}
              >
                Keep this device’s copy
              </button>
              <button
                className="secondary"
                onClick={() => void app.resolveConflict("cloud")}
              >
                Use the other copy
              </button>
            </span>
          ) : (
            path !== "/settings" && (
              <Link to="/settings">Open Account & sync</Link>
            )
          )}
        </div>
      )}
      <main id="main">{content}</main>
      {editing && (
        <NoteEditor
          key={editing.note.id}
          note={editing.note}
          isNew={editing.isNew}
          onSave={app.saveNote}
          onDelete={app.removeNote}
          onClose={() => setEditing(undefined)}
          registerGuard={(g) => (guard.current = g)}
        />
      )}
    </div>
  );

  // Public pages are readable before choosing how to use the app.
  if (!app.space && (path === "/privacy" || path === "/support"))
    return shell(path === "/privacy" ? <Privacy /> : <Support />);
  if (!app.space) return <Welcome app={app} />;

  return shell(
    <Routes>
      <Route path="/" element={<Home app={app} onNew={startNew} />} />
      <Route
        path="/notes"
        element={
          <NotesPage
            notes={app.doc.notes}
            onNew={startNew}
            onOpen={(note) => setEditing({ note, isNew: false })}
          />
        }
      />
      <Route path="/settings" element={<Settings app={app} />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/support" element={<Support />} />
      <Route
        path="*"
        element={
          <>
            <h1>Page not found</h1>
            <Link to="/">Go home</Link>
          </>
        }
      />
    </Routes>,
  );
}
