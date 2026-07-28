/**
 * Alarm copy: map project/global role → Korean honorific for TTS & push.
 * SSOT for client; SQL trigger mirrors the same labels.
 */

export type AlarmRoleInput = string | null | undefined;

/** e.g. master → "관리자님", worker → "근로자" */
export function alarmRoleHonorific(role: AlarmRoleInput): string {
  const r = String(role || "")
    .trim()
    .toLowerCase();

  // Explicit admin/manager aliases (legacy + user request)
  if (r === "admin" || r === "manager" || r === "master" || r === "project_admin") {
    return "관리자님";
  }
  if (r === "safety_manager") return "안전관리자님";
  if (r === "site_manager") return "현장소장님";
  if (r === "supervisor") return "감리님";
  if (r === "site_supervisor") return "관리감독자님";
  if (r === "viewer") return "열람자";
  if (r === "worker" || r === "contractor" || r === "user") return "근로자";

  // Position codes sometimes passed instead of role
  const pos = String(role || "").trim().toUpperCase();
  if (pos === "OWNER_PM" || pos === "OWNER_CM" || pos === "CEO" || pos === "EXECUTIVE") {
    return "관리자님";
  }
  if (pos === "OWNER_SM" || pos === "OWNER_HSE" || pos === "HSE_MANAGER") return "안전관리자님";
  if (pos === "SITE_MANAGER" || pos === "CONSTRUCTION_MGR") return "현장소장님";
  if (pos === "SUPERVISOR") return "감리님";
  if (pos === "SITE_SUPERVISOR") return "관리감독자님";
  if (pos === "WORKER" || pos === "FOREMAN" || pos === "FIELD_ENGINEER") return "근로자";

  return "담당자";
}

/** "박서로 관리자님" */
export function formatAlarmSubject(
  displayName: string | null | undefined,
  role: AlarmRoleInput,
): string {
  const name = (displayName || "").trim() || "미확인";
  return `${name} ${alarmRoleHonorific(role)}`;
}

/** Encode role into zone-event notes so the DB trigger can read it. */
export function encodeRoleLabelInNotes(baseNotes: string, role: AlarmRoleInput): string {
  const label = alarmRoleHonorific(role);
  const cleaned = (baseNotes || "").replace(/\s*\|?\s*role_label=[^\s|]*/g, "").trim();
  return cleaned ? `${cleaned} | role_label=${label}` : `role_label=${label}`;
}

export function buildDangerTtsMessage(opts?: {
  displayName?: string | null;
  role?: AlarmRoleInput;
}): string {
  const base = "경고. 위험 구역에 진입했습니다. 즉시 이탈하십시오.";
  if (!opts?.displayName && !opts?.role) return base;
  const subject = formatAlarmSubject(opts.displayName, opts.role);
  return `${subject}. ${base}`;
}
