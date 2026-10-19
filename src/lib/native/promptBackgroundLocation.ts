import { Capacitor, registerPlugin } from "@capacitor/core";

/** Android: trigger the second-step 「항상 허용」 sheet via background geolocation. */
export async function promptBackgroundLocation(): Promise<void> {
  if (Capacitor.getPlatform() !== "android") return;
  try {
    const BackgroundGeolocation = registerPlugin<{
      addWatcher: (opts: Record<string, unknown>, cb: () => void) => Promise<string>;
      removeWatcher: (opts: { id: string }) => Promise<void>;
    }>("BackgroundGeolocation");
    if (!BackgroundGeolocation?.addWatcher) return;
    const id = await BackgroundGeolocation.addWatcher(
      {
        backgroundMessage: "위험구역 자동감지를 위해 위치를 추적합니다.",
        backgroundTitle: "SafeNex 위치",
        requestPermissions: true,
        stale: true,
        distanceFilter: 50,
      },
      () => {},
    );
    try {
      await BackgroundGeolocation.removeWatcher({ id });
    } catch {
      /* ignore */
    }
  } catch (e) {
    console.warn("[native] background location prompt skipped", e);
  }
}
