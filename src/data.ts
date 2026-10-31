import { z } from "zod";
import { noteSchema } from "./features/notes/model";
// Avoid runtime code generation so the strict Content Security Policy holds.
z.config({ jitless: true });

export const prefsSchema = z
  .object({
    id: z.literal("personal").default("personal"),
    onboarded: z.boolean().default(false),
    theme: z.enum(["light", "dark"]).default("light"),
  })
  .strict();
export type Prefs = z.infer<typeof prefsSchema>;
export const defaults: Prefs = prefsSchema.parse({});

/**
 * Everything a person owns, as one JSON document. This is what is backed up,
 * imported and synced. Add your product's collections next to `notes`.
 */
export const documentSchema = z
  .object({
    version: z.literal(1),
    preferences: prefsSchema,
    notes: z.array(noteSchema).max(5000),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const ids = new Set<string>();
    for (const note of doc.notes) {
      if (ids.has(note.id))
        ctx.addIssue({ code: "custom", message: "Duplicate note ID." });
      ids.add(note.id);
    }
  });
export type AppDocument = z.infer<typeof documentSchema>;
export const emptyDocument = (): AppDocument => ({
  version: 1,
  preferences: { ...defaults, onboarded: true },
  notes: [],
});
