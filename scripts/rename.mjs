#!/usr/bin/env node
// Rebrand the template: updates app.config.json and the native iOS/Android projects.
// Usage: npm run rename -- --name "Quit Buddy" --id com.example.quitbuddy [--short "Quit"] [--scheme quitbuddy]
import {
  readFile,
  writeFile,
  readdir,
  mkdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root =
  process.env.TEMPLATE_ROOT ??
  join(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1]]);
    return pairs;
  }, []),
);
if (!args.name || !args.id) {
  console.error(
    'Usage: npm run rename -- --name "My Product" --id com.company.product',
  );
  process.exit(1);
}
if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(args.id)) {
  console.error(
    "--id must be a reverse-domain ID such as com.company.product (lowercase).",
  );
  process.exit(1);
}
const exists = (path) =>
  stat(path).then(
    () => true,
    () => false,
  );
const configPath = join(root, "app.config.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
const previous = {
  name: config.name,
  appId: config.appId,
  scheme: config.urlScheme,
};
const scheme = args.scheme ?? args.id.split(".").at(-1).replace(/_/g, "");
Object.assign(config, {
  name: args.name,
  shortName: args.short ?? args.name.slice(0, 20),
  appId: args.id,
  urlScheme: scheme,
});
await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
const changed = ["app.config.json"];

async function edit(path, transform) {
  if (!(await exists(path))) return;
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) {
    await writeFile(path, after);
    changed.push(path.slice(root.length + 1));
  }
}
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

// Android
const android = join(root, "android/app");
await edit(join(android, "build.gradle"), (s) =>
  s.replaceAll(`"${previous.appId}"`, `"${args.id}"`),
);
await edit(join(android, "src/main/res/values/strings.xml"), (s) =>
  s
    .replace(/(<string name="app_name">)[^<]*/, `$1${xml(args.name)}`)
    .replace(
      /(<string name="title_activity_main">)[^<]*/,
      `$1${xml(args.name)}`,
    )
    .replace(/(<string name="package_name">)[^<]*/, `$1${args.id}`)
    .replace(/(<string name="custom_url_scheme">)[^<]*/, `$1${args.id}`),
);
for (const kind of ["main", "test", "androidTest"]) {
  const base = join(android, "src", kind, "java");
  const from = join(base, ...previous.appId.split("."));
  if (!(await exists(from)) || previous.appId === args.id) continue;
  const to = join(base, ...args.id.split("."));
  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);
  for (const file of await readdir(to, { recursive: true })) {
    if (/\.(java|kt)$/.test(file))
      await edit(join(to, file), (s) =>
        s.replace(new RegExp(`\\b${escape(previous.appId)}\\b`, "g"), args.id),
      );
  }
  // Remove now-empty parent folders of the old package.
  let dir = dirname(from);
  while (dir.length > base.length && (await readdir(dir)).length === 0) {
    await rm(dir, { recursive: true });
    dir = dirname(dir);
  }
}
// iOS
await edit(join(root, "ios/App/App.xcodeproj/project.pbxproj"), (s) =>
  s.replaceAll(
    `PRODUCT_BUNDLE_IDENTIFIER = ${previous.appId};`,
    `PRODUCT_BUNDLE_IDENTIFIER = ${args.id};`,
  ),
);
await edit(join(root, "ios/App/App/Info.plist"), (s) =>
  s.replace(
    /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*/,
    `$1${xml(args.name)}`,
  ),
);
console.log(
  `Renamed ${previous.name} (${previous.appId}) → ${args.name} (${args.id}).`,
);
for (const file of changed) console.log(`  updated ${file}`);
console.log(
  "Next: replace icons in assets/ and public/, then run `npm run mobile:sync`.",
);
