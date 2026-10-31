import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App";
import { config } from "../src/config";
import { deleteAll, selectSpace } from "../src/storage";
import { emptyDocument } from "../src/data";
import { leaveApp } from "../src/mobile";

vi.mock("../src/mobile", async () => ({
  ...(await vi.importActual<typeof import("../src/mobile")>("../src/mobile")),
  leaveApp: vi.fn().mockResolvedValue(undefined),
  exportFile: vi.fn().mockResolvedValue(undefined),
}));
const user = { id: "4804ed06-315d-4aac-a67b-351ad8d97f3f", username: "tester" };
type Handler = (path: string, init?: RequestInit) => Response | undefined;
let handler: Handler = () => undefined;
let cloud = { revision: 0, data: emptyDocument() };
function server(path: string, init?: RequestInit) {
  const custom = handler(path, init);
  if (custom) return custom;
  const method = init?.method ?? "GET";
  if (path === "/api/auth/session") return Response.json({ user: null });
  if (path === "/api/data" && method === "GET") return Response.json(cloud);
  if (path === "/api/data" && method === "PUT") {
    const body = JSON.parse(String(init!.body));
    cloud = { revision: cloud.revision + 1, data: body.data };
    return Response.json({ revision: cloud.revision });
  }
  return new Response(null, { status: 204 });
}
const launch = (path = "/") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
beforeEach(() => {
  handler = () => undefined;
  cloud = { revision: 0, data: emptyDocument() };
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) =>
      Promise.resolve(server(url, init)),
    ),
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const space of [
    { kind: "account", userId: user.id },
    { kind: "device" },
  ] as const) {
    selectSpace(space);
    await deleteAll();
  }
});

it("first visit offers account, device-only and sample choices; privacy is readable first", async () => {
  launch();
  expect(
    await screen.findByRole("heading", { name: config.tagline }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Create account or sign in" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: /Use on this device/ }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("link", { name: "Privacy" }));
  expect(
    await screen.findByRole("heading", { name: "Privacy", level: 1 }),
  ).toBeVisible();
});

it("device-only notes persist across restarts, and delete-all returns to welcome", async () => {
  const event = userEvent.setup();
  const view = launch();
  await event.click(
    await screen.findByRole("button", { name: /Use on this device/ }),
  );
  await event.click(await screen.findByRole("button", { name: "New note" }));
  await event.click(screen.getByRole("button", { name: "Save note" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("title");
  await event.type(screen.getByLabelText("Title"), "Groceries");
  await event.type(screen.getByLabelText("Note", { exact: true }), "Eggs");
  await event.click(screen.getByRole("button", { name: "Save note" }));
  expect(await screen.findByText(/You have 1 note/)).toBeVisible();
  view.unmount();
  launch("/notes");
  await event.click(await screen.findByRole("button", { name: /Groceries/ }));
  await event.clear(screen.getByLabelText("Title"));
  await event.type(screen.getByLabelText("Title"), "Shopping");
  await event.click(screen.getByRole("button", { name: "Save note" }));
  expect(await screen.findByRole("button", { name: /Shopping/ })).toBeVisible();
  await event.click(screen.getByRole("link", { name: "Settings" }));
  const dark = await screen.findByRole("checkbox", {
    name: "Dark appearance",
  });
  await event.click(dark);
  await waitFor(() =>
    expect(document.documentElement.dataset.theme).toBe("dark"),
  );
  expect(screen.getByText(/saved only on this device/)).toBeVisible();
  await event.click(screen.getByRole("button", { name: "Delete all my data" }));
  await event.click(screen.getByRole("button", { name: "Delete everything" }));
  expect(
    await screen.findByRole("button", { name: "Create account or sign in" }),
  ).toBeVisible();
});

it("sample data is labelled, temporary and separate", async () => {
  const event = userEvent.setup();
  launch();
  await event.click(
    await screen.findByRole("button", { name: "Explore with sample data" }),
  );
  expect(await screen.findByText(/Sample data · changes/)).toBeVisible();
  expect(screen.getByText(/You have 3 notes/)).toBeVisible();
  await event.click(screen.getByRole("button", { name: "Leave sample" }));
  expect(
    await screen.findByRole("button", { name: "Create account or sign in" }),
  ).toBeVisible();
});

it("registers, shows the recovery code once, syncs quietly and signs out", async () => {
  const event = userEvent.setup();
  handler = (path) =>
    path === "/api/auth/register"
      ? Response.json({ user, recoveryCode: "c".repeat(64) }, { status: 201 })
      : undefined;
  launch();
  await event.click(
    await screen.findByRole("button", { name: "Create account or sign in" }),
  );
  await event.type(screen.getByLabelText("Username"), "tester");
  await event.type(screen.getByLabelText("Password"), "a-long-enough-password");
  await event.click(screen.getByRole("button", { name: "Create my account" }));
  expect(await screen.findByLabelText("Recovery code")).toHaveTextContent(
    "c".repeat(64),
  );
  await event.click(
    screen.getByRole("button", { name: "I’ve saved my recovery code" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Hello, tester" }),
  ).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await event.click(screen.getByRole("button", { name: "New note" }));
  await event.type(screen.getByLabelText("Title"), "Synced note");
  await event.click(screen.getByRole("button", { name: "Save note" }));
  await waitFor(() => expect(cloud.data.notes).toHaveLength(1), {
    timeout: 3000,
  });
  await event.click(screen.getByRole("link", { name: "Settings" }));
  expect(await screen.findByText("Signed in as tester")).toBeVisible();
  expect(screen.getByText(/Last successful sync: \d/)).toBeVisible();
  await event.click(screen.getByRole("button", { name: "Sign out" }));
  expect(
    await screen.findByRole("button", { name: "Create account or sign in" }),
  ).toBeVisible();
});

it("an expired session keeps local records and asks to sign in again", async () => {
  const event = userEvent.setup();
  localStorage.setItem(
    `${config.appId.replaceAll(".", "-")}-last-account`,
    JSON.stringify(user),
  );
  let signedIn = false;
  handler = (path) => {
    if (path === "/api/auth/login") {
      signedIn = true;
      return Response.json({ user });
    }
    if (path === "/api/data" && !signedIn)
      return Response.json({ error: "Please sign in" }, { status: 401 });
    return undefined;
  };
  launch();
  expect(await screen.findByRole("alert")).toHaveTextContent("Sign in again");
  await event.click(screen.getByRole("link", { name: "Open Account & sync" }));
  await event.type(screen.getByLabelText("Account password"), "a-password-ok");
  await event.click(screen.getByRole("button", { name: "Sign in again" }));
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
});

it("shows a conflict choice instead of overwriting another device's changes", async () => {
  const event = userEvent.setup();
  handler = (path, init) => {
    if (path === "/api/auth/session") return Response.json({ user });
    if (path === "/api/data" && init?.method === "PUT")
      return Response.json({ error: "changed" }, { status: 409 });
    return undefined;
  };
  launch();
  await event.click(await screen.findByRole("button", { name: "New note" }));
  await event.type(screen.getByLabelText("Title"), "Mine");
  await event.click(screen.getByRole("button", { name: "Save note" }));
  expect(
    await screen.findByRole(
      "button",
      { name: "Use the other copy" },
      {
        timeout: 3000,
      },
    ),
  ).toBeVisible();
  handler = (path) =>
    path === "/api/auth/session" ? Response.json({ user }) : undefined;
  await event.click(
    screen.getByRole("button", { name: "Keep this device’s copy" }),
  );
  await waitFor(() =>
    expect(cloud.data.notes.map((n) => n.title)).toEqual(["Mine"]),
  );
});

it("Back goes detail → parent → Home, then leaves the app", async () => {
  vi.mocked(leaveApp).mockClear();
  const event = userEvent.setup();
  launch();
  await event.click(
    await screen.findByRole("button", { name: /Use on this device/ }),
  );
  await event.click(await screen.findByRole("link", { name: "Settings" }));
  await event.click(screen.getByRole("link", { name: "Help & support" }));
  expect(
    await screen.findByRole("link", { name: "Back to Settings" }),
  ).toBeVisible();
  fireEvent(window, new Event("app:back"));
  expect(
    await screen.findByRole("heading", { name: "Settings", level: 1 }),
  ).toBeVisible();
  fireEvent(window, new Event("app:back"));
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
    "Welcome",
  );
  fireEvent(window, new Event("app:back"));
  await waitFor(() => expect(leaveApp).toHaveBeenCalledOnce());
});
