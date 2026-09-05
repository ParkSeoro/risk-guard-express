import { Capacitor, registerPlugin } from "@capacitor/core";
import { toast } from "sonner";

/** Opens OS app settings so the worker can tap 항상 허용. */
export async function openNativeAppSettings(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    toast.message("설정 → 사이트 권한 → 위치에서 허용해 주세요.");
    return;
  }
  try {
    const BackgroundGeolocation = registerPlugin<{ openSettings: () => Promise<void> }>(
      "BackgroundGeolocation",
    );
    if (BackgroundGeolocation?.openSettings) {
      await BackgroundGeolocation.openSettings();
      return;
    }
  } catch {
    /* fall through */
  }
  toast.message("설정 → 앱 → SafeNex 에서 위치를 「항상 허용」으로 바꿔 주세요.");
}
