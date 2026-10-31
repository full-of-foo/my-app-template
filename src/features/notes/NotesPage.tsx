import type { Note } from "./model";

export default function NotesPage({
  notes,
  onOpen,
  onNew,
}: {
  notes: Note[];
  onOpen: (note: Note) => void;
  onNew: () => void;
}) {
  return (
    <>
      <h1>Notes</h1>
      <p className="lead">
        An example feature showing local storage, sync, backup and an editor.
      </p>
      {notes.length === 0 ? (
        <section className="panel empty">
          <p>No notes yet.</p>
          <button className="primary" onClick={onNew}>
            Write your first note
          </button>
        </section>
      ) : (
        <ul className="list" aria-label="Notes">
          {notes.map((note) => (
            <li key={note.id}>
              <button onClick={() => onOpen(note)}>
                <strong>{note.title}</strong>
                <span className="muted">
                  {note.body.slice(0, 90) || "No text"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
