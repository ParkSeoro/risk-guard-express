/**
 * Project position SSOT — company type → available 직책.
 * 발주처: PM / CM / SM
 * 시공사: 감리(SUPERVISOR)와 관리감독자(SITE_SUPERVISOR) 분리
 */

import { normalizeCompanyType } from '@/lib/companyTypes';

export type ProjectPosition =
  | 'CEO'
  | 'EXECUTIVE'
  | 'SITE_MANAGER'
  | 'HSE_MANAGER'
  | 'CONSTRUCTION_MGR'
  | 'FIELD_ENGINEER'
  | 'FOREMAN'
  | 'WORKER'
  | 'OWNER_PM'
  | 'OWNER_CM'
  | 'OWNER_SM'
  | 'OWNER_HSE' // legacy alias of OWNER_SM
  | 'SUPERVISOR' // 감리
  | 'SITE_SUPERVISOR'; // 관리감독자

export const POSITION_LABELS: Record<string, string> = {
  CEO: '대표이사',
  EXECUTIVE: '임원',
  SITE_MANAGER: '현장소장',
  HSE_MANAGER: '안전관리자',
  CONSTRUCTION_MGR: '공사부장',
  FIELD_ENGINEER: '공사담당',
  FOREMAN: '직장/조장',
  WORKER: '작업자',
  OWNER_PM: '발주처 PM',
  OWNER_CM: '발주처 CM',
  OWNER_SM: '발주처 SM',
  OWNER_HSE: '발주처 SM', // legacy
  SUPERVISOR: '감리',
  SITE_SUPERVISOR: '관리감독자',
};

/** Positions selectable per company type (발주처 → 시공사 → 협력사 → 공급사). */
export const POSITIONS_BY_COMPANY_TYPE: Record<string, ProjectPosition[]> = {
  client: ['OWNER_PM', 'OWNER_CM', 'OWNER_SM', 'CEO', 'EXECUTIVE'],
  gc: [
    'CEO',
    'EXECUTIVE',
    'SITE_MANAGER',
    'HSE_MANAGER',
    'CONSTRUCTION_MGR',
    'FIELD_ENGINEER',
    'SUPERVISOR', // 감리
    'SITE_SUPERVISOR', // 관리감독자
    'FOREMAN',
    'WORKER',
  ],
  contractor: [
    'CEO',
    'EXECUTIVE',
    'SITE_MANAGER',
    'HSE_MANAGER',
    'CONSTRUCTION_MGR',
    'FIELD_ENGINEER',
    'SITE_SUPERVISOR', // 관리감독자 (협력사)
    'FOREMAN',
    'WORKER',
  ],
  vendor: ['CEO', 'EXECUTIVE', 'FIELD_ENGINEER', 'FOREMAN', 'WORKER'],
};

/** Default project_role when assigning a position. */
export function defaultRoleForPosition(position: string | null | undefined): string {
  switch ((position || '').toUpperCase()) {
    case 'OWNER_PM':
    case 'OWNER_CM':
    case 'CEO':
    case 'EXECUTIVE':
      return 'project_admin';
    case 'OWNER_SM':
    case 'OWNER_HSE':
    case 'HSE_MANAGER':
      return 'safety_manager';
    case 'SITE_MANAGER':
    case 'CONSTRUCTION_MGR':
      return 'site_manager';
    case 'SUPERVISOR': // 감리
      return 'supervisor';
    case 'SITE_SUPERVISOR': // 관리감독자
      return 'site_supervisor';
    case 'FOREMAN':
    case 'FIELD_ENGINEER':
    case 'WORKER':
      return 'worker';
    default:
      return 'viewer';
  }
}

/**
 * Canonical position for a project_role (SSOT pair).
 * Used when role is edited so position_new stays aligned
 * (e.g. site_supervisor ↔ SITE_SUPERVISOR, supervisor ↔ SUPERVISOR).
 */
export function defaultPositionForRole(
  role: string | null | undefined,
  companyType?: string | null,
): ProjectPosition | null {
  switch ((role || '').toLowerCase()) {
    case 'site_supervisor':
      return 'SITE_SUPERVISOR';
    case 'supervisor':
      return 'SUPERVISOR';
    case 'safety_manager': {
      const t = normalizeCompanyType(companyType);
      if (t === 'client') return 'OWNER_SM';
      return 'HSE_MANAGER';
    }
    case 'site_manager':
      return 'SITE_MANAGER';
    case 'worker':
      return 'WORKER';
    case 'project_admin': {
      const t = normalizeCompanyType(companyType);
      if (t === 'client') return 'OWNER_CM';
      return null; // keep existing position for GC/contractor admins
    }
    default:
      return null;
  }
}

/** Patch object to keep role_new ↔ position_new in sync on membership edits. */
export function syncMembershipRolePosition(opts: {
  field: 'role_new' | 'position_new' | string;
  value: string | null;
  companyType?: string | null;
}): Record<string, string | null> {
  const out: Record<string, string | null> = { [opts.field]: opts.value };
  if (opts.field === 'position_new' && opts.value) {
    out.role_new = defaultRoleForPosition(opts.value);
  } else if (opts.field === 'role_new' && opts.value) {
    const pos = defaultPositionForRole(opts.value, opts.companyType);
    if (pos) out.position_new = pos;
  }
  return out;
}

export function positionsForCompanyType(companyType: string | null | undefined): ProjectPosition[] {
  const code = normalizeCompanyType(companyType);
  if (code && POSITIONS_BY_COMPANY_TYPE[code]) return POSITIONS_BY_COMPANY_TYPE[code];
  // Unknown: show union without duplicates / legacy OWNER_HSE
  const seen = new Set<string>();
  const out: ProjectPosition[] = [];
  for (const list of Object.values(POSITIONS_BY_COMPANY_TYPE)) {
    for (const p of list) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
  }
  return out;
}

export function positionLabel(code: string | null | undefined): string {
  if (!code) return '';
  return POSITION_LABELS[code] || POSITION_LABELS[code.toUpperCase()] || code;
}
