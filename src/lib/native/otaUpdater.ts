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

/**
 * Compare app/OTA versions. CI publishes `1.0.0-YYYYMMDDHHMM` — the old
 * `split(".").map(Number)` treated the date suffix as NaN so every 1.0.0-*
 * build compared equal and phones never downloaded newer OTAs.
 */
export function cmpVersion(a: string, b: string): number {
  const parts = (v: string) => {
    const nums = String(v).match(/\d+/g);
    return nums ? nums.map((n) => Number(n)) : [0];
  };
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

export type OtaStatus = {
  native: boolean;
  channel: "stable" | "beta";
  currentVersion: string;
  latestVersion: string | null;
  mandatory: boolean;
  hasUpdate: boolean;
  message: string;
};

export async function getOtaStatus(): Promise<OtaStatus> {
  const channel = getChannel();
  if (!isNativeApp()) {
    return {
      native: false,
      channel,
      currentVersion: "웹",
      latestVersion: null,
      mandatory: false,
      hasUpdate: false,
      message: "웹/PC는 OTA가 필요 없습니다. 새로고침하면 최신입니다.",
    };
  }
  try {
    const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
    const current = await CapacitorUpdater.current();
    const currentVersion = String((current as any)?.bundle?.version || "내장");
    const { data, error } = await supabase.rpc("get_latest_app_release", {
      _channel: channel,
    } as any);
    if (error) {
      return {
        native: true,
        channel,
        currentVersion,
        latestVersion: null,
        mandatory: false,
        hasUpdate: false,
        message: "서버 릴리스 조회 실패: " + error.message,
      };
    }
    const release: any = Array.isArray(data) ? data[0] : data;
    const latestVersion = release?.version ? String(release.version) : null;
    const mandatory = !!release?.mandatory;
    const hasUpdate =
      !!latestVersion && cmpVersion(latestVersion, currentVersion === "내장" ? "0.0.0" : currentVersion) > 0;
    return {
      native: true,
      channel,
      currentVersion,
      latestVersion,
      mandatory,
      hasUpdate,
      message: hasUpdate
        ? `새 버전 ${latestVersion} 있음 → 다운로드 후 앱을 완전히 종료했다가 다시 실행하세요`
        : latestVersion
          ? `최신입니다 (서버 ${latestVersion})`
          : "게시된 OTA 릴리스가 없습니다",
    };
  } catch (e: any) {
    return {
      native: true,
      channel,
      currentVersion: "?",
      latestVersion: null,
      mandatory: false,
      hasUpdate: false,
      message: "OTA 상태 확인 실패: " + (e?.message || String(e)),
    };
  }
}

/** Download latest bundle if newer. Returns user-facing Korean result. */
export async function checkAndDownloadOta(): Promise<{
  ok: boolean;
  message: string;
  version?: string;
  apply: "immediate" | "next_cold_start" | "none";
}> {
  if (!isNativeApp()) {
    return { ok: true, message: "웹은 새로고침으로 업데이트됩니다.", apply: "none" };
  }
  try {
    const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
    await CapacitorUpdater.notifyAppReady();
    const current = await CapacitorUpdater.current();
    const currentVersion = String((current as any)?.bundle?.version || "0.0.0");

    const { data, error } = await supabase.rpc("get_latest_app_release", {
      _channel: getChannel(),
    } as any);
    if (error) return { ok: false, message: "릴리스 조회 실패: " + error.message, apply: "none" };
    const release: any = Array.isArray(data) ? data[0] : data;
    if (!release?.bundle_url || !release?.version) {
      return { ok: true, message: "게시된 업데이트가 없습니다.", apply: "none" };
    }
    if (cmpVersion(String(release.version), currentVersion) <= 0) {
      return {
        ok: true,
        message: `이미 최신입니다 (${release.version})`,
        version: String(release.version),
        apply: "none",
      };
    }

    let downloadUrl = release.bundle_url as string;
    if (downloadUrl.startsWith("storage:")) {
      const path = downloadUrl.replace(/^storage:/, "");
      const { data: signed, error: sErr } = await supabase.storage
        .from("app-updates")
        .createSignedUrl(path, 60 * 60);
      if (sErr || !signed?.signedUrl) {
        return { ok: false, message: "다운로드 URL 생성 실패", apply: "none" };
      }
      downloadUrl = signed.signedUrl;
    }

    const bundle = await CapacitorUpdater.download({
      url: downloadUrl,
      version: release.version,
      checksum: release.checksum || undefined,
    } as any);

    if (release.mandatory) {
      await CapacitorUpdater.set({ id: bundle.id } as any);
      return {
        ok: true,
        message: `${release.version} 적용 중 (앱이 곧 다시 시작됩니다)`,
        version: String(release.version),
        apply: "immediate",
      };
    }
    await CapacitorUpdater.next({ id: bundle.id } as any);
    return {
      ok: true,
      message: `${release.version} 다운로드 완료. 최근 앱에서 SafeNex를 완전히 종료한 뒤 다시 실행하세요.`,
      version: String(release.version),
      apply: "next_cold_start",
    };
  } catch (e: any) {
    return { ok: false, message: e?.message || String(e), apply: "none" };
  }
}

export async function initOtaUpdater() {
  if (!isNativeApp()) return;
  try {
    const r = await checkAndDownloadOta();
    if (r.ok && r.apply !== "none") {
      console.info(`[ota] ${r.message}`);
    }
  } catch (e) {
    console.warn("[ota] updater init failed", e);
  }
}
