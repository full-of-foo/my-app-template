import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { App as NativeApp } from "@capacitor/app";
import { config, storagePrefix } from "./config";
export const isNative = () => Capacitor.isNativePlatform();
/** Android convention: Back on a top-level screen leaves the app (backgrounds it). */
export async function leaveApp() {
  if (isNative() && Capacitor.getPlatform() === "android")
    await NativeApp.minimizeApp();
}
export function apiOrigin() {
  const origin = import.meta.env.VITE_API_ORIGIN || config.productionOrigin;
  const url = new URL(origin);
  const local =
    import.meta.env.MODE === "mobile-test" &&
    ["localhost", "127.0.0.1", "10.0.2.2"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw Error("Invalid mobile API origin. Release builds require HTTPS.");
  return url.origin;
}
export async function requestApi(
  path: string,
  method: string,
  body?: unknown,
): Promise<Pick<Response, "status" | "ok" | "json">> {
  if (!/^\/[a-z0-9_/-]+$/i.test(path)) throw Error("Invalid API path");
  if (!isNative())
    return fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
  const origin = apiOrigin();
  const response = await CapacitorHttp.request({
    url: `${origin}/api${path}`,
    method,
    headers: {
      Origin: origin,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { data: body } : {}),
    responseType: "json",
    connectTimeout: 15000,
    readTimeout: 15000,
    disableRedirects: true,
  });
  return {
    status: response.status,
    ok: response.status >= 200 && response.status < 300,
    json: async () =>
      typeof response.data === "string"
        ? JSON.parse(response.data)
        : response.data,
  };
}
export async function exportFile(name: string, text: string, type: string) {
  if (!isNative()) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  // Private cache only; never leave personal exports in a public downloads directory.
  const path = `${storagePrefix}-export-${crypto.randomUUID()}-${name.replace(/[^a-z0-9.-]/gi, "_")}`;
  const file = await Filesystem.writeFile({
    path,
    data: text,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  try {
    await Share.share({
      title: `${config.name} backup`,
      files: [file.uri],
      dialogTitle: "Save or share your private backup",
    });
  } catch (error) {
    // Both native Share plugins reject this exact message on user dismissal.
    // Dismissal is a normal outcome; real export failures must still surface.
    if (!(
      error &&
      typeof error === "object" &&
      "message" in error &&
      error.message === "Share canceled"
    ))
      throw error;
  } finally {
    await Filesystem.deleteFile({ path, directory: Directory.Cache });
  }
}
