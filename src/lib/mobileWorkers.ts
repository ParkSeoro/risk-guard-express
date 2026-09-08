export type MobileWorkersTab = "roster" | "attendance" | "signatures";

export const MOBILE_WORKERS_PATH = "/app/worker/workers";
export const MOBILE_WORKERS_ATTENDANCE_PATH = `${MOBILE_WORKERS_PATH}?tab=attendance`;
export const MOBILE_WORKERS_SIGNATURES_PATH = `${MOBILE_WORKERS_PATH}?tab=signatures`;

/** 앱 근로자·출입 탭. 서명 원장은 관리자만. */
export function resolveMobileWorkersTab(
  raw: string | null,
  canViewSignatures: boolean,
): MobileWorkersTab {
  if (raw === "attendance") return "attendance";
  if (raw === "signatures" && canViewSignatures) return "signatures";
  return "roster";
}
