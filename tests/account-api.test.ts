import { afterEach, expect, it, vi } from "vitest";
import {
  api,
  ApiError,
  authenticate,
  deleteAccount,
  eraseCloud,
  getCloud,
  getSession,
  putCloud,
  signOut,
} from "../src/account-api";
import { emptyDocument } from "../src/data";
afterEach(() => vi.unstubAllGlobals());
const user = { id: "4804ed06-315d-4aac-a67b-351ad8d97f3f", username: "test" };
const data = emptyDocument();

it("validates responses and sends same-origin, uncached requests", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ user }))
    .mockResolvedValueOnce(Response.json({ user, recoveryCode: "secret" }))
    .mockResolvedValueOnce(Response.json({ revision: 1, data }))
    .mockResolvedValueOnce(Response.json({ revision: 2 }))
    .mockResolvedValueOnce(Response.json({ revision: 3 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  expect(await getSession()).toEqual(user);
  expect(
    (await authenticate("recover", "test", "long-password", "code"))
      .recoveryCode,
  ).toBe("secret");
  expect(await getCloud()).toEqual({ revision: 1, data });
  expect(await putCloud(1, data)).toEqual({ revision: 2 });
  expect(await eraseCloud()).toEqual({ revision: 3 });
  await signOut();
  await deleteAccount("pw");
  expect(fetcher).toHaveBeenCalledWith(
    "/api/data",
    expect.objectContaining({
      credentials: "same-origin",
      cache: "no-store",
      method: "PUT",
    }),
  );
});

it("turns network, server and non-JSON failures into readable errors", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("down")));
  await expect(api("/auth/session")).rejects.toMatchObject({ status: 0 });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(Response.json({ error: "Nope" }, { status: 409 })),
  );
  await expect(api("/data")).rejects.toEqual(new ApiError("Nope", 409));
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })),
  );
  await expect(api("/data")).rejects.toMatchObject({ status: 503 });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({}, { status: 500 })),
  );
  await expect(api("/data")).rejects.toThrow("could not be completed");
});
