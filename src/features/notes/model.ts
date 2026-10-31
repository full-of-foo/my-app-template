// Example feature. Replace or delete this folder when you build your product;
// see docs/NEW_APP_CHECKLIST.md.
import { z } from "zod";
export const noteSchema = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1, "Give the note a title.").max(120),
    body: z.string().max(5000).default(""),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type Note = z.infer<typeof noteSchema>;
export const newNote = (title: string, body = ""): Note =>
  noteSchema.parse({
    id: crypto.randomUUID(),
    title,
    body,
    updatedAt: Date.now(),
  });
export const sampleNotes = (): Note[] => [
  newNote(
    "Welcome to the sample",
    "These notes are sample data. Changes here are temporary.",
  ),
  newNote("Try editing", "Open a note, change it and save."),
  newNote("Your data stays separate", "Leaving the sample removes it."),
];
