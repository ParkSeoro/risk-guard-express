import {
  classifyPermissionPersona,
  personaMatchesFilter,
  type PermissionPersonaFilter,
} from "@/lib/permissions";

export type ManageableUserRow = {
  user_id: string;
  account_status: string;
  display_name?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  roles: string[];
};

export type MembershipRow = {
  user_id: string;
  project_id: string;
  role_new?: string | null;
};

/**
 * 승인대기 탭은 가입 심사 큐다. 기본 화면이 관리자 탭이어도
 * 근로자/미배정 가입자가 목록에서 빠지면 안 된다.
 */
export function skipPersonaForApprovalQueue(filterStatus: string): boolean {
  return filterStatus === "pending";
}

export function personaOfUser(opts: {
  userId: string;
  globalRoles: string[];
  memberships: MembershipRow[];
  filterProject: string;
}) {
  const mems = (opts.memberships || []).filter(
    (m) => opts.filterProject === "all" || m.project_id === opts.filterProject,
  );
  return classifyPermissionPersona({
    globalRoles: opts.globalRoles,
    projectRoles: mems.map((m) => m.role_new),
  });
}

export function matchesManageableUserFilters(opts: {
  user: ManageableUserRow;
  memberships: MembershipRow[];
  filterStatus: string;
  filterProject: string;
  filterPersona: PermissionPersonaFilter;
  search: string;
}): boolean {
  const { user, memberships, filterStatus, filterProject, filterPersona, search } = opts;
  if (filterStatus !== "all" && user.account_status !== filterStatus) return false;
  if (filterProject !== "all") {
    if (!memberships.some((m) => m.project_id === filterProject)) return false;
  }
  if (!skipPersonaForApprovalQueue(filterStatus)) {
    const persona = personaOfUser({
      userId: user.user_id,
      globalRoles: user.roles,
      memberships,
      filterProject,
    });
    if (!personaMatchesFilter(persona, filterPersona)) return false;
  }
  const term = search.trim().toLowerCase();
  if (!term) return true;
  return (
    (user.display_name || "").toLowerCase().includes(term) ||
    (user.company || "").toLowerCase().includes(term) ||
    (user.phone || "").toLowerCase().includes(term) ||
    (user.email || "").toLowerCase().includes(term)
  );
}
