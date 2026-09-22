/** Isolated Vision Fleet client — talks only to vision-fleet edge function. */

const FN = "vision-fleet";

export function visionFleetFnPath(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${FN}${p.startsWith("/v1") ? p : `/v1${p}`}`;
}

export type VisionGrantAction = "live_substream" | "live_mainstream" | "playback" | "evidence.request";

/** Default live view: full quality, 4-pane wall. Substream stays available for metered sites. */
export const VISION_LIVE_ACTION: VisionGrantAction = "live_mainstream";
export const VISION_LIVE_BITRATE_KBPS = 4096;
export const VISION_LIVE_TTL_MS = 30 * 60_000;

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

/** Setup, rename, delete. Everyone else only sees the 4-pane wall. */
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

export const VISION_CAMERA_SLOTS = 4;

export function visionQuadPageCount(cameraCount: number, pageSize = VISION_CAMERA_SLOTS): number {
  if (cameraCount <= pageSize) return 1;
  return Math.ceil(cameraCount / pageSize);
}

export function visionCameraSlots<T extends { id: string }>(cameras: T[], page = 0): Array<T | null> {
  const start = Math.max(0, page) * VISION_CAMERA_SLOTS;
  const slots: Array<T | null> = cameras.slice(start, start + VISION_CAMERA_SLOTS);
  while (slots.length < VISION_CAMERA_SLOTS) slots.push(null);
  return slots;
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

export function visionEventSirenAllowed(opts: {
  type?: string | null;
  severity?: string | null;
  alarmInterlockEnabled?: boolean;
}): boolean {
  if (opts.type === "vision_safety_event") return false;
  if (!opts.alarmInterlockEnabled) return false;
  return opts.severity === "critical";
}
