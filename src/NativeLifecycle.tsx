import { useEffect } from "react";
import { App as NativeApp } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import { isNative } from "./mobile";
export default function NativeLifecycle() {
  useEffect(() => {
    if (!isNative()) return;
    let active = true;
    const listeners: PluginListenerHandle[] = [];
    const remember = async (pending: Promise<PluginListenerHandle>) => {
      const handle = await pending;
      if (!active) await handle.remove();
      else listeners.push(handle);
    };
    void remember(
      NativeApp.addListener("backButton", () =>
        window.dispatchEvent(new Event("app:back")),
      ),
    );
    void remember(
      NativeApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive) window.dispatchEvent(new Event("online"));
        else document.dispatchEvent(new Event("app:background"));
      }),
    );
    return () => {
      active = false;
      for (const handle of listeners) void handle.remove();
    };
  }, []);
  return null;
}
