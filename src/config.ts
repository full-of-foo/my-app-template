// Single source for product identity. Edit app.config.json (or run `npm run rename`).
import raw from "../app.config.json";
import { z } from "zod";
export const appConfigSchema = z
  .object({
    name: z.string().min(1).max(40),
    shortName: z.string().min(1).max(20),
    tagline: z.string().min(1).max(120),
    description: z.string().min(1).max(300),
    appId: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
    urlScheme: z.string().regex(/^[a-z][a-z0-9+.-]*$/),
    productionOrigin: z.url(),
    themeColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    publisher: z.string().min(1),
    supportEmail: z.email(),
  })
  .strict();
export const config = appConfigSchema.parse(raw);
/** Prefix for browser/device storage names, derived from the app ID. */
export const storagePrefix = config.appId.replaceAll(".", "-");
