/**
 * Pre-login Play Store gate: if the installed AAB is older than
 * app_releases.min_native_version, block on a full-screen prompt.
 * Play Console uploads do not notify the app unless this field is set.
 */
import { isNativeApp, nativePlatform } from "./platform";
import { openPlayStore } from "@/lib/playStore";
import {
  fetchNativeStoreUpdateState,
  formatNativeVersionLabel,
  isStoreUpdateSnoozed,
  snoozeStoreUpdateToday,
  type NativeStoreUpdateState,
} from "./nativeStoreUpdate";

function escapeHtml(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string));
}

function paintStoreSplash(state: NativeStoreUpdateState): Promise<"play" | "snooze"> {
  return new Promise((resolve) => {
    const root = document.getElementById("root");
    if (!root) {
      resolve("snooze");
      return;
    }
    root.dataset.bootStore = "1";
    const current = escapeHtml(formatNativeVersionLabel(state.current));
    const need = escapeHtml(state.minNative || "");
    root.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px;font-family:system-ui,sans-serif;background:linear-gradient(165deg,#0f172a 0%,#1e293b 55%,#0f172a 100%);color:#f8fafc">
        <div style="max-width:360px;width:100%;text-align:center">
          <div style="font-size:22px;font-weight:700;letter-spacing:-0.02em;margin-bottom:8px">앱 업데이트가 필요합니다</div>
          <p style="margin:0 0 16px;line-height:1.55;color:#cbd5e1;font-size:14px">
            Play 스토어에 새 앱(AAB)이 있습니다. 화면 OTA만으로는 위치 추적 등 네이티브 기능이 바뀌지 않습니다.
          </p>
          <p style="margin:0 0 22px;font-size:12px;color:#94a3b8">설치됨 ${current}${need ? ` · 필요 ${need}` : ""}</p>
          <button id="boot-store-play" type="button" style="width:100%;padding:12px 16px;border:0;border-radius:10px;background:#34d399;color:#0f172a;font-weight:700;font-size:15px">
            Play 스토어에서 업데이트
          </button>
          <button id="boot-store-later" type="button" style="width:100%;margin-top:10px;padding:10px;border:0;background:transparent;color:#94a3b8;font-size:13px">
            나중에 (오늘만)
          </button>
        </div>
      </div>
    `;
    document.getElementById("boot-store-play")?.addEventListener("click", () => {
      openPlayStore();
      resolve("play");
    });
    document.getElementById("boot-store-later")?.addEventListener("click", () => {
      snoozeStoreUpdateToday();
      delete root.dataset.bootStore;
      resolve("snooze");
    });
  });
}

/** Returns after the user snoozes, or immediately if no store update is required. */
export async function runBootStoreGate(): Promise<void> {
  if (!isNativeApp() || nativePlatform() !== "android") return;
  try {
    const state = await fetchNativeStoreUpdateState();
    if (!state.needed || isStoreUpdateSnoozed()) return;
    await paintStoreSplash(state);
  } catch {
    /* non-fatal — continue to login */
  }
}
