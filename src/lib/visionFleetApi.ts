/** Isolated Vision Fleet client — talks only to vision-fleet edge function. */

const FN = "vision-fleet";

export function visionFleetFnPath(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${FN}${p.startsWith("/v1") ? p : `/v1${p}`}`;
}

export type VisionGrantAction = "live_substream" | "live_mainstream" | "playback" | "evidence.request";

/** Default live view: one camera at a time. Substream stays available for metered sites. */
export const VISION_LIVE_ACTION: VisionGrantAction = "live_mainstream";
export const VISION_LIVE_BITRATE_KBPS = 4096;
export const VISION_LIVE_TTL_MS = 30 * 60_000;
/** Stop the browser HLS pull after this idle window. An open page holds the upload until then. */
export const VISION_LIVE_IDLE_MS = 10 * 60_000;

export function visionGrantTtlMs(action: VisionGrantAction): number {
  if (action === "live_mainstream") return VISION_LIVE_TTL_MS;
  return 5 * 60_000;
}

export function visionGrantBitrateKbps(action: VisionGrantAction): number {
  if (action === "live_substream") return 700;
  return VISION_LIVE_BITRATE_KBPS;
}

export const VISION_VIEW_ROLES = [
  "master",
  "project_admin",
  "safety_manager",
  "site_manager",
  "supervisor",
  "site_supervisor",
] as const;

export const VISION_OPERATOR_ROLES = [
  "master",
  "project_admin",
  "safety_manager",
  "site_manager",
] as const;

export function visionHasAnyRole(roles: readonly string[] | null | undefined, allowed: readonly string[]): boolean {
  return (roles || []).some((r) => allowed.includes(r));
}

export function visionCanViewConsole(roles: readonly string[] | null | undefined): boolean {
  return visionHasAnyRole(roles, VISION_VIEW_ROLES);
}

export function visionCanOperate(roles: readonly string[] | null | undefined): boolean {
  return visionHasAnyRole(roles, VISION_OPERATOR_ROLES);
}

/** Setup, rename, delete VPS relay. Master only. */
export function visionCanManage(roles: readonly string[] | null | undefined): boolean {
  return visionHasAnyRole(roles, ["master"]);
}

export function visionRoleLabel(roles: readonly string[] | null | undefined): string {
  const set = new Set(roles || []);
  if (set.has("master")) return "본사 마스터";
  if (set.has("project_admin")) return "프로젝트 관리자";
  if (set.has("safety_manager")) return "안전관리자";
  if (set.has("site_manager")) return "현장소장";
  if (set.has("site_supervisor")) return "현장감독";
  if (set.has("supervisor")) return "감독";
  return "조회";
}

export function sortVisionCamerasByRegistered<T extends { id: string; created_at?: string | null }>(
  cameras: T[],
): T[] {
  return [...cameras].sort((a, b) => {
    const at = a.created_at || "";
    const bt = b.created_at || "";
    if (at && bt && at !== bt) return at.localeCompare(bt);
    if (at && !bt) return -1;
    if (!at && bt) return 1;
    return a.id.localeCompare(b.id);
  });
}

export type StreamProtocol = "rtsp" | "rtmp" | "hls" | "http_video" | "webrtc" | "unknown";

export const SAMPLE_CCTV_STREAM_URL = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

export function detectStreamProtocol(raw: string | null | undefined): {
  protocol: StreamProtocol;
  isBrowserPlayable: boolean;
  message?: string;
} {
  if (!raw || !raw.trim()) return { protocol: "unknown", isBrowserPlayable: false };
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.startsWith("rtsp://")) {
    return {
      protocol: "rtsp",
      isBrowserPlayable: false,
      message: "RTSP 프로토콜은 웹 브라우저에서 직접 재생할 수 없습니다. MediaMTX/VPS 중계 서버(HLS .m3u8)를 거쳐 변환된 주소를 사용해야 합니다.",
    };
  }
  if (trimmed.startsWith("rtmp://") || trimmed.startsWith("rtmps://")) {
    return {
      protocol: "rtmp",
      isBrowserPlayable: false,
      message: "RTMP는 송출 전용 프로토콜로 브라우저 직접 재생이 불가능합니다. HLS(.m3u8) 또는 WebRTC 재생 주소를 입력하세요.",
    };
  }
  if (trimmed.includes(".m3u8") || trimmed.includes("application/vnd.apple.mpegurl")) {
    return { protocol: "hls", isBrowserPlayable: true };
  }
  if (trimmed.startsWith("webrtc://") || trimmed.includes("/whep")) {
    return { protocol: "webrtc", isBrowserPlayable: true };
  }
  if (trimmed.endsWith(".mp4") || trimmed.endsWith(".webm")) {
    return { protocol: "http_video", isBrowserPlayable: true };
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return { protocol: "http_video", isBrowserPlayable: true };
  }
  return { protocol: "unknown", isBrowserPlayable: false, message: "올바른 스트림 주소(http, https, m3u8)를 입력해 주세요." };
}

/** Browser playback only. RTSP/file URLs never go into <video>. */
export function visionSafePlaybackUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password) return null;
  return trimmed;
}

/** While this page is open, tell the relay someone is watching even if HLS stalls. */
export function visionViewerHoldUrl(playbackUrl: string | null | undefined): string | null {
  const safe = visionSafePlaybackUrl(playbackUrl);
  if (!safe) return null;
  const next = safe.replace(/\/index\.m3u8(\?.*)?$/i, "/viewer-status");
  return next === safe ? null : next;
}

/** Open the relay hold before the camera's next RTMP reconnect (setup / reveal). */
export function wakeVisionViewerHold(playbackUrl: string | null | undefined): void {
  const hold = visionViewerHoldUrl(playbackUrl);
  if (!hold || typeof fetch !== "function") return;
  void fetch(hold, { cache: "no-store" }).catch(() => undefined);
}

export function visionEventSirenAllowed(opts: {
  type?: string | null;
  severity?: string | null;
  alarmInterlockEnabled?: boolean;
}): boolean {
  if (opts.type === "vision_safety_event") return false;
  if (!opts.alarmInterlockEnabled) return false;
  return opts.severity === "critical";
}
