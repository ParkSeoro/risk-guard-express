/** Mobile shell v1 — role buckets, nav items, home path. */
import type { MobileRole } from "@/hooks/useMobileAccess";

export type MobileShellBucket = "worker" | "manager" | "master";

export function resolveMobileShellBucket(
  role: MobileRole | string,
  isMaster?: boolean,
): MobileShellBucket {
  if (isMaster || role === "master") return "master";
  if (
    role === "project_admin" ||
    role === "safety_manager" ||
    role === "site_manager" ||
    role === "supervisor" ||
    role === "site_supervisor"
  ) {
    return "manager";
  }
  return "worker";
}

export function isManagerMobileRole(role: MobileRole | string, isMaster?: boolean): boolean {
  const b = resolveMobileShellBucket(role, isMaster);
  return b === "manager" || b === "master";
}

export type MobileTabKey = "today" | "tasks" | "approvals" | "docs" | "alerts" | "more";

export type MobileTab = {
  key: MobileTabKey;
  label: string;
  path: string;
};

const BASE = "/app/worker";

export function mobileTabsForBucket(bucket: MobileShellBucket): MobileTab[] {
  if (bucket === "worker") {
    return [
      { key: "today", label: "오늘", path: `${BASE}/today` },
      { key: "tasks", label: "할 일", path: `${BASE}/tasks` },
      { key: "docs", label: "자료", path: `${BASE}/docs` },
      { key: "alerts", label: "알림", path: `${BASE}/alerts` },
      { key: "more", label: "더보기", path: `${BASE}/more` },
    ];
  }
  // manager + master — include 알림 inbox (was worker-only; settings ≠ history)
  return [
    { key: "today", label: "오늘", path: `${BASE}/today` },
    { key: "tasks", label: "할 일", path: `${BASE}/tasks` },
    { key: "approvals", label: "결재", path: `${BASE}/approvals` },
    { key: "alerts", label: "알림", path: `${BASE}/alerts` },
    { key: "more", label: "더보기", path: `${BASE}/more` },
  ];
}

export const MOBILE_TODAY = `${BASE}/today`;
export const MOBILE_WORK_STOP = `${BASE}/work-stop`;

export function roleLabelKo(role: MobileRole | string): string {
  switch (role) {
    case "master":
      return "마스터";
    case "project_admin":
      return "프로젝트 관리자";
    case "safety_manager":
      return "안전관리자";
    case "site_manager":
      return "현장관리자";
    case "supervisor":
      return "관리감독자";
    case "site_supervisor":
      return "감리";
    case "worker":
    case "contractor":
      return "근로자";
    default:
      return "사용자";
  }
}
