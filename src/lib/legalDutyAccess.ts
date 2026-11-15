/** 법적업무의 대장·건진법 칸을 누가 보는지. 회사 범위는 companyDocScope가 따로 자른다. */

const GENERAL_MANAGER_ROLES = new Set([
  "project_admin",
  "safety_manager",
  "site_manager",
  "supervisor",
  "site_supervisor",
]);

/** 건진법 서류의 작성·검토 직책. 안전관리자(HSE_MANAGER)는 넣지 않는다. */
const CTPA_POSITIONS = new Set([
  "SITE_MANAGER",
  "CONSTRUCTION_MGR",
  "FIELD_ENGINEER",
  "SUPERVISOR",
  "OWNER_CM",
  "OWNER_PM",
]);

export function canViewLegalCompanyDocs(opts: {
  isMaster: boolean;
  userRole: string | null | undefined;
  userCompanyType: string | null | undefined;
}): boolean {
  if (opts.isMaster) return true;
  if (opts.userCompanyType === "client") return true;
  return GENERAL_MANAGER_ROLES.has(String(opts.userRole || ""));
}

/** 발주자 확인 완료는 발주처 관리자, 프로젝트 관리자, 마스터만. 관리감독자는 열람만. */
export function canEditClientLedger(opts: {
  isMaster: boolean;
  userRole: string | null | undefined;
  userCompanyType: string | null | undefined;
}): boolean {
  if (opts.isMaster) return true;
  const role = String(opts.userRole || "");
  if (opts.userCompanyType === "client" && GENERAL_MANAGER_ROLES.has(role)) return true;
  return role === "project_admin";
}

export function isLegalHseManager(opts: {
  userRole: string | null | undefined;
  userPosition: string | null | undefined;
}): boolean {
  const position = opts.userPosition || "";
  return position === "HSE_MANAGER" || (opts.userRole === "safety_manager" && !CTPA_POSITIONS.has(position));
}

/** 건진법 작성은 현장소장·공사직책·감리·발주 직책과 프로젝트 관리자. 관리감독자 권한만으로는 열람. */
export function canEditCtpa(opts: {
  isMaster: boolean;
  userRole: string | null | undefined;
  userPosition: string | null | undefined;
}): boolean {
  if (opts.isMaster) return true;
  const position = opts.userPosition || "";
  if (position === "HSE_MANAGER") return false;
  const role = String(opts.userRole || "");
  if (role === "site_manager" || role === "supervisor" || role === "project_admin") return true;
  return CTPA_POSITIONS.has(position);
}
