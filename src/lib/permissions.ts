/**
 * App-wide role union used by AuthContext / AuthGuard.
 * Global: user_roles.role (currently only `master`).
 * Project: project_members.role_new (SSOT for partner/company admins).
 */
export type GlobalRole = "master";

export type ProjectRole =
  | "project_admin"
  | "safety_manager"
  | "site_manager"
  | "supervisor"
  | "site_supervisor"
  | "worker"
  | "viewer";

/** Combined role string carried in AuthContext.roles */
export type AppRole = GlobalRole | ProjectRole | (string & {});

export const ADMIN_PROJECT_ROLES: ProjectRole[] = [
  "project_admin",
  "safety_manager",
  "site_manager",
  "supervisor",
  "site_supervisor",
];

export const WORKER_PROJECT_ROLES: ProjectRole[] = ["worker", "viewer"];

/** Mobile field worker only — not 열람자. */
export const FIELD_WORKER_PROJECT_ROLES: ProjectRole[] = ["worker"];

export type PermissionPersona = "manager" | "worker" | "both" | "unassigned";
export type PermissionPersonaFilter = "all" | "manager" | "worker" | "unassigned";

/**
 * 설정 → 권한 관리 구분:
 * - manager: 웹 관리자(마스터·프로젝트 역할·열람자)
 * - worker: 현장 작업자(role_new=worker)
 * - both: 한 계정에 관리 역할과 작업자가 같이 있음
 * - unassigned: 프로젝트 소속·마스터 없음 (가입 승인 대기 등)
 */
export function classifyPermissionPersona(opts: {
  globalRoles?: string[] | null;
  projectRoles?: string[] | null;
}): PermissionPersona {
  const global = (opts.globalRoles || []).map((r) => String(r || "").toLowerCase());
  const project = (opts.projectRoles || []).map((r) => String(r || "").toLowerCase());
  const isMaster = global.includes("master");
  const isManagerRole = project.some((r) => (ADMIN_PROJECT_ROLES as string[]).includes(r));
  const isViewer = project.some((r) => r === "viewer");
  const isFieldWorker = project.some((r) => (FIELD_WORKER_PROJECT_ROLES as string[]).includes(r));
  const isManager = isMaster || isManagerRole || isViewer;
  if (isManager && isFieldWorker) return "both";
  if (isManager) return "manager";
  if (isFieldWorker) return "worker";
  return "unassigned";
}

export function personaMatchesFilter(
  persona: PermissionPersona,
  filter: PermissionPersonaFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "manager") return persona === "manager" || persona === "both";
  if (filter === "worker") return persona === "worker" || persona === "both";
  return persona === "unassigned";
}

export function permissionPersonaLabel(persona: PermissionPersona): string {
  if (persona === "both") return "관리자·근로 겸임";
  if (persona === "manager") return "관리자";
  if (persona === "worker") return "근로자";
  return "미배정";
}
