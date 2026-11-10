/**
 * Android hardware / gesture back:
 * - Can leave current route → history.back()
 * - Already on Today → minimize (don't exit WebView blank)
 */
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";

const ROOTS = new Set([
  "/app/worker/today",
  "/app/worker",
  "/app/worker/",
  "/login",
  "/consent",
  "/native-permissions",
  "/app-language",
]);

export default function NativeAndroidBack() {
  const navigate = useNavigate();
  const location = useLocation();
  const locRef = useRef({ pathname: location.pathname, search: location.search });
  locRef.current = { pathname: location.pathname, search: location.search };

  useEffect(() => {
    if (!Capacitor?.isNativePlatform?.()) return;
    if (Capacitor.getPlatform() !== "android") return;

    let handle: { remove: () => Promise<void> } | null = null;
    let cancelled = false;

    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        if (cancelled) return;
        handle = await App.addListener("backButton", ({ canGoBack }) => {
          const { pathname: path, search } = locRef.current;
          if (
            (path === "/app/worker/messenger" || path === "/app/admin/messenger") &&
            new URLSearchParams(search).has("room")
          ) {
            navigate(path, { replace: true });
            return;
          }
          if (ROOTS.has(path)) {
            void App.minimizeApp();
            return;
          }
          if (canGoBack || window.history.length > 1) {
            navigate(-1);
            return;
          }
          void App.minimizeApp();
        });
      } catch (e) {
        console.warn("[NativeAndroidBack] init failed", e);
      }
    })();

    return () => {
      cancelled = true;
      void handle?.remove?.();
    };
  }, [navigate]);

  return null;
}
