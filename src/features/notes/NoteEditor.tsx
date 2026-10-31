import { useEffect, useRef, useState } from "react";
import { Check, Trash2, X } from "lucide-react";
import { isNative } from "../../mobile";
import { noteSchema, type Note } from "./model";

/**
 * Full-height task surface on phones (leading Close, trailing Save), dialog on
 * larger web screens. Unsaved edits are confirmed before closing.
 */
export default function NoteEditor({
  note,
  isNew,
  onSave,
  onDelete,
  onClose,
  registerGuard,
}: {
  note: Note;
  isNew: boolean;
  onSave: (note: Note) => Promise<unknown>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
  registerGuard: (guard: () => boolean) => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [error, setError] = useState("");
  const dirty = title !== note.title || body !== note.body;
  const titleRef = useRef<HTMLInputElement>(null);
  const confirmLeave = () =>
    !dirty || window.confirm("Discard your unsaved changes?");
  useEffect(() => {
    registerGuard(confirmLeave);
  });
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  const close = () => {
    if (confirmLeave()) onClose();
  };
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, []);
  return (
    <div className={`overlay${isNative() ? " native-sheet" : ""}`}>
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
        onSubmit={async (e) => {
          e.preventDefault();
          const parsed = noteSchema.safeParse({ ...note, title, body });
          if (!parsed.success) {
            setError(parsed.error.issues[0].message);
            return;
          }
          try {
            await onSave(parsed.data);
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not save.");
          }
        }}
      >
        <div className="sheet-toolbar">
          <button
            type="button"
            className="text"
            aria-label="Close editor"
            onClick={close}
          >
            <X size={20} aria-hidden /> Close
          </button>
          <h2 id="editor-title">{isNew ? "New note" : "Edit note"}</h2>
          <button className="text strong" aria-label="Save note">
            <Check size={20} aria-hidden /> Save
          </button>
        </div>
        <div className="sheet-body">
          <label>
            Title
            <input
              ref={titleRef}
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Note
            <textarea
              rows={8}
              maxLength={5000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {!isNew && (
            <button
              type="button"
              className="danger"
              onClick={async () => {
                if (!window.confirm("Delete this note?")) return;
                await onDelete(note.id);
                onClose();
              }}
            >
              <Trash2 size={16} aria-hidden /> Delete note
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
