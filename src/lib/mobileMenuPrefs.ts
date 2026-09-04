/**
 * 모바일 메뉴 타일 사용자별 표시 환경설정
 * - 역할별 기본 프리셋 + 사용자가 toggle 가능 (localStorage)
 */
export type MobileTileKey =
  | "inspect" | "incident" | "tbm" | "scan" | "permits" | "actions"
  | "alerts" | "approvals" | "risk" | "work-plans" | "workers"
  | "attendance" | "daily-health" | "manual" | "distribution";

export const ALL_TILES: { key: MobileTileKey; label: string }[] = [
  { key: "inspect", label: "안전점검" },
  { key: "incident", label: "사고 신고" },
  { key: "tbm", label: "TBM 진행" },
  { key: "scan", label: "QR 스캔" },
  { key: "permits", label: "허가서 결재" },
  { key: "actions", label: "조치 관리" },
  { key: "alerts", label: "알림" },
  { key: "approvals", label: "전자결재" },
  { key: "risk", label: "위험성평가" },
  { key: "work-plans", label: "작업계획" },
  { key: "workers", label: "근로자 QR" },
  { key: "attendance", label: "입퇴장 현황" },
  { key: "daily-health", label: "일일 건강로그" },
  { key: "manual", label: "사용 설명서" },
  { key: "distribution", label: "근로자 분포" },
];

const PRESETS: Record<string, MobileTileKey[]> = {
  // 일반 근로자 — 출퇴근/TBM/허가서 위주
  worker: ["scan", "tbm", "permits", "alerts", "daily-health", "manual"],
  // 현장 관리자 — 점검/TBM/허가서/근로자
  supervisor: ["inspect", "tbm", "permits", "incident", "workers", "attendance", "distribution", "alerts", "actions", "manual"],
  // 안전관리자/마스터 — 전체
  safety: ["inspect", "incident", "tbm", "scan", "permits", "actions", "alerts", "approvals", "risk", "work-plans", "workers", "attendance", "distribution", "daily-health", "manual"],
};

const KEY = "mobile:tiles:v1";

export function getMobileTiles(role: "worker" | "supervisor" | "safety"): MobileTileKey[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MobileTileKey[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return PRESETS[role] ?? PRESETS.supervisor;
}

export function setMobileTiles(tiles: MobileTileKey[]) {
  try { localStorage.setItem(KEY, JSON.stringify(tiles)); } catch {}
  try { window.dispatchEvent(new Event("mobile:tiles-changed")); } catch {}
}

export function resetMobileTiles() {
  try { localStorage.removeItem(KEY); } catch {}
  try { window.dispatchEvent(new Event("mobile:tiles-changed")); } catch {}
}

export function detectRole(hasRole: (r: string) => boolean): "worker" | "supervisor" | "safety" {
  if (hasRole("master") || hasRole("safety_manager")) return "safety";
  if (hasRole("project_admin") || hasRole("site_manager") || hasRole("supervisor") || hasRole("site_supervisor")) return "supervisor";
  return "worker";
}
