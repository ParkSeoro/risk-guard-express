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
  client: ['OWNER_PM', 'OWNER_CM', 'OWNER_SM', 'SUPERVISOR', 'CEO', 'EXECUTIVE'],
  gc: [
    'CEO',
    'EXECUTIVE',
    'SITE_MANAGER',
    'HSE_MANAGER',
    'CONSTRUCTION_MGR',
    'FIELD_ENGINEER',
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

/**
 * Default project_role when a position is a 1:1 permission title.
 * Job titles (공사부장·공사담당·조장) do not imply a role — return null
 * so the existing role (e.g. 관리감독자) is kept.
 */
export function defaultRoleForPosition(position: string | null | undefined): string | null {
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
      return 'site_manager';
    case 'SUPERVISOR': // 감리
      return 'supervisor';
    case 'SITE_SUPERVISOR': // 관리감독자
      return 'site_supervisor';
    case 'WORKER':
      return 'worker';
    case 'CONSTRUCTION_MGR':
    case 'FIELD_ENGINEER':
    case 'FOREMAN':
      return null;
    default:
      return null;
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
    case 'project_admin':
      // 발주처(PM/CM/SM)·시공사/협력사 모두 직책이 다양하므로 강제 기본 직책을 덮어쓰지 않음
      return null;
    default:
      return null;
  }
}

/**
 * Patch object for membership edits.
 * - 권한(role_new)과 직책(position_new)은 독립적으로 조합할 수 있어야 함
 *   (예: project_admin + OWNER_SM / OWNER_PM / OWNER_CM).
 * - 반대쪽 값이 이미 지정되어 있으면 강제로 덮어쓰지 않고,
 *   비어 있거나 초기값(viewer / WORKER 승격)일 때만 기본 추천값을 채워줌.
 */
export function syncMembershipRolePosition(opts: {
  field: 'role_new' | 'position_new' | string;
  value: string | null;
  companyType?: string | null;
  currentPosition?: string | null;
  currentRole?: string | null;
}): Record<string, string | null> {
  const out: Record<string, string | null> = { [opts.field]: opts.value };
  if (opts.field === 'position_new' && opts.value) {
    const curRole = (opts.currentRole || '').trim().toLowerCase();
    if (!curRole || curRole === 'viewer') {
      const role = defaultRoleForPosition(opts.value);
      if (role) out.role_new = role;
    }
  } else if (opts.field === 'role_new' && opts.value) {
    const nextRole = opts.value.toLowerCase();
    const curPos = (opts.currentPosition || '').trim().toUpperCase();
    const shouldAutoFillPosition =
      !curPos || (curPos === 'WORKER' && nextRole !== 'worker' && nextRole !== 'viewer');
    if (shouldAutoFillPosition) {
      const pos = defaultPositionForRole(opts.value, opts.companyType);
      if (pos) out.position_new = pos;
    }
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
