// @vitest-environment node
import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  cp,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("rebrands the config and native projects without touching unrelated text", async () => {
  const root = await mkdtemp(join(tmpdir(), "rename-"));
  await cp("app.config.json", join(root, "app.config.json"));
  const java = join(root, "android/app/src/main/java/com/example/myapp");
  await mkdir(java, { recursive: true });
  await writeFile(
    join(java, "MainActivity.java"),
    "package com.example.myapp;\npublic class MainActivity {}\n",
  );
  await writeFile(
    join(root, "android/app/build.gradle"),
    'namespace "com.example.myapp"\napplicationId "com.example.myapp"\n',
  );
  await mkdir(join(root, "android/app/src/main/res/values"), {
    recursive: true,
  });
  await writeFile(
    join(root, "android/app/src/main/res/values/strings.xml"),
    '<resources><string name="app_name">My App</string><string name="title_activity_main">My App</string><string name="package_name">com.example.myapp</string><string name="custom_url_scheme">com.example.myapp</string></resources>',
  );
  await mkdir(join(root, "ios/App/App.xcodeproj"), { recursive: true });
  await writeFile(
    join(root, "ios/App/App.xcodeproj/project.pbxproj"),
    "PRODUCT_BUNDLE_IDENTIFIER = com.example.myapp;\nOTHER = com.example.myapp.tests;\n",
  );
  await mkdir(join(root, "ios/App/App"), { recursive: true });
  await writeFile(
    join(root, "ios/App/App/Info.plist"),
    "<key>CFBundleDisplayName</key>\n<string>My App</string>",
  );
  execFileSync(
    process.execPath,
    [
      "scripts/rename.mjs",
      "--name",
      "Quit & Thrive",
      "--id",
      "app.quit.thrive",
    ],
    { env: { ...process.env, TEMPLATE_ROOT: root } },
  );
  const read = (p: string) => readFile(join(root, p), "utf8");
  expect(JSON.parse(await read("app.config.json"))).toMatchObject({
    name: "Quit & Thrive",
    appId: "app.quit.thrive",
    urlScheme: "thrive",
  });
  expect(await read("android/app/build.gradle")).toBe(
    'namespace "app.quit.thrive"\napplicationId "app.quit.thrive"\n',
  );
  expect(
    await read("android/app/src/main/java/app/quit/thrive/MainActivity.java"),
  ).toContain("package app.quit.thrive;");
  await expect(
    stat(join(root, "android/app/src/main/java/com")),
  ).rejects.toThrow();
  expect(await read("android/app/src/main/res/values/strings.xml")).toContain(
    '<string name="app_name">Quit &amp; Thrive</string>',
  );
  const pbx = await read("ios/App/App.xcodeproj/project.pbxproj");
  expect(pbx).toContain("PRODUCT_BUNDLE_IDENTIFIER = app.quit.thrive;");
  expect(pbx).toContain("OTHER = com.example.myapp.tests;");
  expect(await read("ios/App/App/Info.plist")).toContain(
    "<string>Quit &amp; Thrive</string>",
  );
  expect(() =>
    execFileSync(process.execPath, ["scripts/rename.mjs", "--name", "X"], {
      env: { ...process.env, TEMPLATE_ROOT: root },
      stdio: "pipe",
    }),
  ).toThrow();
});
