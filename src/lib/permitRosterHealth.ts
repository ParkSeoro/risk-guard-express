/**
 * Non-blocking occupational health warning badges for Work Permit roster assignment.
 * Surfaces 유소견(D1/D2), 요관찰(C), 작업제한 소견(health_restrictions), and expired
 * checkup due dates (`next_checkup_due < today`) so supervisors see risks before assigning.
 */
import { todayKstDateStr } from "./workPlanOcrHelpers";

export interface WorkerHealthSummaryFields {
  health_checkup_status?: string | null;
  next_checkup_due?: string | null;
  health_restrictions?: string | null;
  health_grade?: string | null;
}

export interface WorkerHealthBadge {
  id: "finding" | "observation" | "restriction" | "expired";
  severity: "danger" | "warn";
  label: string;
  tooltip: string;
}

const BENIGN_RESTRICTION_RE = /^(정상|없음|해당\s*없음|특이사항\s*없음|정상업무\s*가능|업무적합|적합|-)$/i;

export function evaluateWorkerHealthWarnings(
  w: WorkerHealthSummaryFields,
  todayKst: string = todayKstDateStr(),
): WorkerHealthBadge[] {
  const badges: WorkerHealthBadge[] = [];
  const grade = String(w.health_grade || w.health_checkup_status || "").trim();

  if (grade.startsWith("유소견")) {
    badges.push({
      id: "finding",
      severity: "danger",
      label: grade,
      tooltip: `건강진단 ${grade} 판정 — 위험작업 배치 전 사후관리 소견을 확인하세요.`,
    });
  } else if (grade.startsWith("요관찰")) {
    badges.push({
      id: "observation",
      severity: "warn",
      label: grade,
      tooltip: `건강진단 ${grade} 판정 — 작업 전 건강상태를 확인하세요.`,
    });
  }

  const restriction = String(w.health_restrictions || "").trim();
  if (restriction && !BENIGN_RESTRICTION_RE.test(restriction)) {
    const shortText = restriction.length > 12 ? `${restriction.slice(0, 12)}…` : restriction;
    badges.push({
      id: "restriction",
      severity: "danger",
      label: `제한: ${shortText}`,
      tooltip: `작업제한·사후관리 소견: ${restriction}`,
    });
  }

  const due = String(w.next_checkup_due || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(due) && due < todayKst) {
    badges.push({
      id: "expired",
      severity: "warn",
      label: "검진만료",
      tooltip: `차기 건강진단 기한(${due})이 경과했습니다.`,
    });
  }

  return badges;
}
