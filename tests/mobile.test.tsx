import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { App as NativeApp } from "@capacitor/app";
import { apiOrigin, requestApi, exportFile, leaveApp } from "../src/mobile";
import NativeLifecycle from "../src/NativeLifecycle";
import { config } from "../src/config";
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    getPlatform: vi.fn(() => "web"),
  },
  CapacitorHttp: { request: vi.fn() },
}));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: { writeFile: vi.fn(), deleteFile: vi.fn() },
  Directory: { Cache: "CACHE" },
  Encoding: { UTF8: "utf8" },
}));
vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn() } }));
vi.mock("@capacitor/app", () => ({
  App: { addListener: vi.fn(), getLaunchUrl: vi.fn(), minimizeApp: vi.fn() },
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
});
it("M02: validates native API origins and never enables arbitrary cleartext or credential-bearing URLs", () => {
  expect(apiOrigin()).toBe(config.productionOrigin);
  for (const origin of [
    "http://evil.test",
    "https://user:secret@example.test",
    "https://example.test/path",
    "https://example.test?token=secret",
    "https://example.test#secret",
  ]) {
    vi.stubEnv("VITE_API_ORIGIN", origin);
    expect(() => apiOrigin()).toThrow();
  }
  vi.stubEnv("MODE", "mobile-test");
  vi.stubEnv("VITE_API_ORIGIN", "http://10.0.2.2:3001");
  expect(apiOrigin()).toBe("http://10.0.2.2:3001");
});
it("M02: native API uses the platform cookie jar and HTTPS transport with no bearer token in web storage", async () => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  vi.mocked(CapacitorHttp.request).mockResolvedValueOnce({
    status: 200,
    data: { user: null },
    headers: {},
    url: `${config.productionOrigin}/api/auth/session`,
  });
  const response = await requestApi("/auth/session", "GET");
  expect(response.ok).toBe(true);
  expect(await response.json()).toEqual({ user: null });
  expect(CapacitorHttp.request).toHaveBeenCalledWith(
    expect.objectContaining({
      url: `${config.productionOrigin}/api/auth/session`,
      headers: {
        Origin: config.productionOrigin,
        Accept: "application/json",
      },
      disableRedirects: true,
    }),
  );
  vi.mocked(CapacitorHttp.request).mockResolvedValueOnce({
    status: 401,
    data: '{"error":"Denied"}',
    headers: {},
    url: "",
  });
  const denied = await requestApi("/data", "PUT", { revision: 1 });
  expect(denied.ok).toBe(false);
  expect(await denied.json()).toEqual({ error: "Denied" });
  expect(CapacitorHttp.request).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: { revision: 1 },
      headers: expect.objectContaining({ "Content-Type": "application/json" }),
    }),
  );
  await expect(requestApi("//evil.test", "GET")).rejects.toThrow(
    "Invalid API path",
  );
  vi.mocked(CapacitorHttp.request).mockRejectedValueOnce(Error("offline"));
  await expect(requestApi("/data", "GET")).rejects.toThrow("offline");
  vi.mocked(CapacitorHttp.request).mockResolvedValueOnce({
    status: 502,
    data: "<html>",
    headers: {},
    url: "",
  });
  await expect((await requestApi("/data", "GET")).json()).rejects.toThrow();
});
it("M05: native export shares a private cache file and removes it on success and cancellation", async () => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  vi.mocked(Filesystem.writeFile).mockResolvedValue({
    uri: "file:///private/cache/export.json",
  });
  vi.mocked(Share.share).mockResolvedValue({});
  await exportFile("backup.json", "private", "application/json");
  expect(Filesystem.writeFile).toHaveBeenCalledWith(
    expect.objectContaining({
      data: "private",
      directory: "CACHE",
      encoding: "utf8",
    }),
  );
  expect(Share.share).toHaveBeenCalledWith(
    expect.objectContaining({ files: ["file:///private/cache/export.json"] }),
  );
  expect(Filesystem.deleteFile).toHaveBeenCalledOnce();
  vi.mocked(Share.share).mockRejectedValueOnce(Error("cancelled"));
  await expect(
    exportFile("../../backup.json", "private", "application/json"),
  ).rejects.toThrow("cancelled");
  expect(Filesystem.deleteFile).toHaveBeenCalledTimes(2);
  vi.mocked(Share.share).mockRejectedValueOnce({ message: "Share canceled" });
  await expect(
    exportFile("backup.json", "private", "application/json"),
  ).resolves.toBeUndefined();
  expect(Filesystem.deleteFile).toHaveBeenCalledTimes(3);
  vi.mocked(Filesystem.writeFile).mockRejectedValueOnce(Error("disk full"));
  await expect(
    exportFile("backup.json", "private", "application/json"),
  ).rejects.toThrow("disk full");
});
it("registers back and foreground/background handlers natively, then removes them", async () => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  const handlers: Record<string, (event: never) => void> = {};
  const remove = vi.fn();
  vi.mocked(NativeApp.addListener).mockImplementation((name, fn) => {
    handlers[name] = fn;
    return Promise.resolve({ remove });
  });
  const back = vi.fn(),
    online = vi.fn(),
    background = vi.fn();
  window.addEventListener("app:back", back);
  window.addEventListener("online", online);
  document.addEventListener("app:background", background);
  const view = render(<NativeLifecycle />);
  await act(async () => {});
  await act(async () => {
    handlers.backButton({} as never);
    handlers.appStateChange({ isActive: true } as never);
    handlers.appStateChange({ isActive: false } as never);
  });
  expect(back).toHaveBeenCalledOnce();
  expect(online).toHaveBeenCalledOnce();
  expect(background).toHaveBeenCalledOnce();
  view.unmount();
  expect(remove).toHaveBeenCalledTimes(2);
  window.removeEventListener("app:back", back);
  window.removeEventListener("online", online);
  document.removeEventListener("app:background", background);
});
it("no native listeners on web; delayed registration is cleaned after unmount", async () => {
  render(<NativeLifecycle />);
  expect(NativeApp.addListener).not.toHaveBeenCalled();
  cleanup();
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  const pending: ((value: { remove: () => Promise<void> }) => void)[] = [];
  vi.mocked(NativeApp.addListener).mockImplementation(
    () => new Promise((resolve) => pending.push(resolve)),
  );
  const view = render(<NativeLifecycle />);
  view.unmount();
  const remove = vi.fn().mockResolvedValue(undefined);
  await act(async () => {
    for (const resolve of pending) resolve({ remove });
  });
  expect(remove).toHaveBeenCalledTimes(2);
});
it("M01/M05: web export keeps browser downloads and revokes the temporary object URL", async () => {
  vi.useFakeTimers();
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    Object.assign(globalThis.URL, {
      createObjectURL: vi.fn(() => "blob:private"),
      revokeObjectURL: revoke,
    }),
  );
  await exportFile("backup.json", "private", "application/json");
  expect(click).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(1000);
  expect(revoke).toHaveBeenCalledWith("blob:private");
  vi.useRealTimers();
});
it("P3: Android Back at the root backgrounds the app; iOS and web never minimize", async () => {
  await leaveApp();
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  vi.mocked(Capacitor.getPlatform).mockReturnValue("ios");
  await leaveApp();
  expect(NativeApp.minimizeApp).not.toHaveBeenCalled();
  vi.mocked(Capacitor.getPlatform).mockReturnValue("android");
  await leaveApp();
  expect(NativeApp.minimizeApp).toHaveBeenCalledTimes(1);
});
