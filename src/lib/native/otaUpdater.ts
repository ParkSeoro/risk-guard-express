// OTA 자동 업데이트 부트스트랩 (Capgo Capacitor Updater + Supabase Storage 호스팅)
// - 네이티브 앱에서만 작동. 웹/프리뷰에서는 no-op.
// - 부팅 시 채널별 최신 릴리스를 조회해 백그라운드 다운로드, 다음 실행 시 적용.
// - mandatory=true 면 다운로드 직후 즉시 적용(앱이 재시작됨).
import { supabase } from "@/integrations/supabase/client";
import { isNativeApp } from "./platform";

const CHANNEL_KEY = "app-update-channel";
export function getChannel(): "stable" | "beta" {
  return (localStorage.getItem(CHANNEL_KEY) as any) === "beta" ? "beta" : "stable";
}
export function setChannel(c: "stable" | "beta") {
  localStorage.setItem(CHANNEL_KEY, c);
}

function cmpVersion(a: string, b: string) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

export async function initOtaUpdater() {
  if (!isNativeApp()) return;
  try {
    const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
    // 새 번들 적용 후 부팅 안정 신호 (없으면 5초 후 롤백)
    await CapacitorUpdater.notifyAppReady();

    const current = await CapacitorUpdater.current();
    const currentVersion = (current as any)?.bundle?.version || "0.0.0";

    const { data, error } = await supabase.rpc("get_latest_app_release", { _channel: getChannel() } as any);
    if (error) { console.warn("[ota] release lookup", error); return; }
    const release: any = Array.isArray(data) ? data[0] : data;
    if (!release?.bundle_url || !release?.version) return;
    if (cmpVersion(release.version, currentVersion) <= 0) return;

    const bundle = await CapacitorUpdater.download({
      url: release.bundle_url,
      version: release.version,
      checksum: release.checksum || undefined,
    } as any);

    if (release.mandatory) {
      await CapacitorUpdater.set({ id: bundle.id } as any); // 즉시 적용 → 앱 재시작
    } else {
      await CapacitorUpdater.next({ id: bundle.id } as any); // 다음 콜드 부팅 시 적용
    }
    console.info(`[ota] downloaded ${release.version} (mandatory=${release.mandatory})`);
  } catch (e) {
    console.warn("[ota] updater init failed", e);
  }
}
