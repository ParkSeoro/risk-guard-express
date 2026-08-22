/** Isolated Vision Fleet client — talks only to vision-fleet edge function. */

const FN = "vision-fleet";

export function visionFleetFnPath(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${FN}${p.startsWith("/v1") ? p : `/v1${p}`}`;
}

export type VisionGrantAction = "live_substream" | "live_mainstream" | "playback" | "evidence.request";

export function visionGrantTtlMs(action: VisionGrantAction): number {
  if (action === "live_mainstream") return 3 * 60_000;
  return 5 * 60_000;
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

export function visionCameraSlots<T extends { id: string }>(cameras: T[]): Array<T | null> {
  const slots: Array<T | null> = cameras.slice(0, VISION_CAMERA_SLOTS);
  while (slots.length < VISION_CAMERA_SLOTS) slots.push(null);
  return slots;
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
