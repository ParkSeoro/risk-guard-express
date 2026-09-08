export type MobileWorkersTab = "roster" | "attendance" | "signatures";

/** 앱 근로자 화면 탭. 서명 원장은 관리자만. */
export function resolveMobileWorkersTab(
  raw: string | null,
  canViewSignatures: boolean,
): MobileWorkersTab {
  if (raw === "attendance") return "attendance";
  if (raw === "signatures" && canViewSignatures) return "signatures";
  return "roster";
}
