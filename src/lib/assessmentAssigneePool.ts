import { ADMIN_PROJECT_ROLES } from '@/lib/permissions';

const ADMIN_ROLE_SET = new Set<string>(ADMIN_PROJECT_ROLES);

export type AssigneeCompanyMember = {
  user_id: string;
  company_id?: string | null;
};

export type CompanyManagerRow = {
  id: string;
  name: string;
  user_id: string | null;
  department_id: string | null;
  company_id: string;
  position?: string | null;
  is_primary?: boolean | null;
};

export type AssigneePoolRow = {
  source?: string;
  source_id?: string;
  user_id: string | null;
  display_name: string;
  position?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  department_id?: string | null;
  department_name?: string | null;
  role?: string | null;
};

export type AssessmentAssigneeOption = {
  key: string;
  user_id: string | null;
  display_name: string;
  position: string;
  company_id: string | null;
  company_name: string;
  department_id: string | null;
  department_name: string;
};

const POSITION_LABEL: Record<string, string> = {
  SITE_MANAGER: '현장소장',
  site_manager: '현장소장',
  SUPERVISOR: '감리',
  supervisor: '감리',
  SITE_SUPERVISOR: '관리감독자',
  site_supervisor: '관리감독자',
  HSE_MANAGER: '안전관리자',
  safety_manager: '안전관리자',
  project_admin: '프로젝트관리자',
  OWNER_SM: '발주처 SM',
  OWNER_CM: '발주처 CM',
};

export function isProjectManagerRole(role?: string | null): boolean {
  if (!role) return false;
  return ADMIN_ROLE_SET.has(role);
}

/**
 * Company that owns the RA for assignee picking:
 * 1) created_by membership company
 * 2) run.target_company_ids
 * 3) current viewer's company
 */
export function resolveAuthorCompanyIds(opts: {
  createdBy?: string | null;
  creatorMembers: AssigneeCompanyMember[];
  targetCompanyIds?: string[] | null;
  fallbackCompanyId?: string | null;
}): string[] {
  const creator = opts.creatorMembers.find((m) => m.user_id === opts.createdBy);
  if (creator?.company_id) return [creator.company_id];
  const targets = (opts.targetCompanyIds || []).filter(Boolean);
  if (targets.length > 0) return [...new Set(targets)];
  if (opts.fallbackCompanyId) return [opts.fallbackCompanyId];
  return [];
}

export function formatAssigneeLabel(name: string, position?: string | null): string {
  const pos = (position || '').trim();
  if (!pos) return name;
  return `${name} / ${POSITION_LABEL[pos] || pos}`;
}

export function buildAssessmentAssigneeOptions(opts: {
  companyIds: string[];
  poolRows: AssigneePoolRow[];
  companyManagers: CompanyManagerRow[];
  companyNameById: Map<string, string>;
}): AssessmentAssigneeOption[] {
  const companySet = new Set(opts.companyIds);
  const byKey = new Map<string, AssessmentAssigneeOption>();

  for (const r of opts.poolRows) {
    if (!r.user_id) continue;
    if (companySet.size > 0 && r.company_id && !companySet.has(r.company_id)) continue;
    if (r.source === 'project_member' && !isProjectManagerRole(r.role)) continue;
    const existing = byKey.get(r.user_id);
    if (!existing || r.source === 'company_manager') {
      byKey.set(r.user_id, {
        key: r.user_id,
        user_id: r.user_id,
        display_name: r.display_name,
        position: r.position || '',
        company_id: r.company_id || null,
        company_name: r.company_name || '',
        department_id: r.department_id || null,
        department_name: r.department_name || '',
      });
    }
  }

  for (const cm of opts.companyManagers) {
    if (companySet.size > 0 && !companySet.has(cm.company_id)) continue;
    const k = cm.user_id || `mgr:${cm.id}`;
    if (byKey.has(k) || (cm.user_id && byKey.has(cm.user_id))) continue;
    byKey.set(k, {
      key: k,
      user_id: cm.user_id,
      display_name: cm.name,
      position: cm.position || '',
      company_id: cm.company_id,
      company_name: opts.companyNameById.get(cm.company_id) || '',
      department_id: cm.department_id,
      department_name: '',
    });
  }

  return Array.from(byKey.values()).sort((a, b) =>
    a.display_name.localeCompare(b.display_name, 'ko'),
  );
}
