import { normalizeCompanyType, type CompanyTypeCode } from '@/lib/companyTypes';

/**
 * 전자결재 SSOT (Single Source of Truth)
 * ------------------------------------------------------------------
 * 모든 안전 서류(작업허가서, 위험성평가, 작업계획서, 산업안전보건관리비,
 * 사고보고, 비상대피훈련, TBM 일지 등)는 아래 고정 결재선을 사용한다.
 *
 * 내부 1~3단계 라벨은 기안자 회사 유형(협력사/시공사)에 따라 동적으로 바뀐다.
 * Step keys (position)는 SSOT 키를 유지한다.
 */

export type ApprovalEntityType =
  | 'assessment_run'
  | 'work_plan'
  | 'work_permit'
  | 'safety_cost'
  | 'incident'
  | 'emergency_drill'
  | 'tbm';

export const ENTITY_LABELS: Record<ApprovalEntityType, string> = {
  assessment_run: '위험성평가',
  work_plan: '작업계획서',
  work_permit: '작업허가서',
  safety_cost: '산업안전보건관리비',
  incident: '사고보고',
  emergency_drill: '비상대피훈련',
  tbm: 'TBM 일지',
};

/** 고정 결재선 포지션 키 + GC / 협조 슬롯 */
export type ApprovalPositionKey =
  | 'contractor_supervisor'
  | 'contractor_safety_manager'
  | 'contractor_site_director'
  | 'gc'
  | 'gc_manager'
  | 'gc_pm'
  | 'owner_cm'
  | 'owner_sm'
  | 'cooperator';

export const POSITION_LABELS: Record<string, string> = {
  contractor_supervisor: '관리감독자 (상신)',
  contractor_safety_manager: '안전관리자 (검토)',
  contractor_site_director: '현장소장 (승인)',
  gc: '시공사',
  gc_manager: '시공사 관리자',
  gc_pm: '시공사 PM',
  owner_cm: '발주처 CM (공사관리)',
  owner_sm: '발주처 SM (안전관리)',
  cooperator: '협조',

  // legacy — 옛 데이터가 남아있을 수 있어 라벨만 유지 (신규 사용 금지)
  project_admin: '프로젝트 관리자',
  safety_manager: '안전관리자',
  site_manager: '현장대리인',
  supervisor: '관리감독자',
  contractor: '시공사',
  master: '마스터',
  contractor_pic: '담당자(시공)',
  safety_pic: '담당자(안전)',
  site_director: '책임자(소장)',
  cm: '담당자(CM)',
  sm: '담당자(SM)',
};

/** Dynamic step label: 협력사 vs 시공사(직영) 기안자 */
export function stepLabelForAuthor(
  positionKey: string,
  authorCompanyType: CompanyTypeCode | string | null | undefined,
): string {
  const t = normalizeCompanyType(authorCompanyType);
  const org = t === 'gc' ? '시공사' : '협력사';
  switch ((positionKey || '').toLowerCase()) {
    case 'contractor_supervisor':
      return `${org} 관리감독자 (상신)`;
    case 'contractor_safety_manager':
      return `${org} 안전관리자 (검토)`;
    case 'contractor_site_director':
      return `${org} 현장소장 (승인)`;
    case 'gc_manager':
    case 'gc':
    case 'gc_pm':
      return '시공사 관리자';
    case 'owner_cm':
      return '발주처 CM (검토)';
    case 'owner_sm':
      return '발주처 SM (승인)';
    default:
      return POSITION_LABELS[positionKey] || positionKey || '결재';
  }
}

export interface DefaultStep {
  label: string;
  position: ApprovalPositionKey | string;
}

/** 기본 5단계 고정 결재선 (위평/계획서 등) — 협력사 기안 가정 */
export const FIXED_APPROVAL_STEPS: DefaultStep[] = [
  { label: '협력사 관리감독자 (상신)', position: 'contractor_supervisor' },
  { label: '협력사 안전관리자 (검토)', position: 'contractor_safety_manager' },
  { label: '협력사 현장소장 (승인)', position: 'contractor_site_director' },
  { label: '발주처 CM (공사관리)', position: 'owner_cm' },
  { label: '발주처 SM (안전 최종승인)', position: 'owner_sm' },
];

/** 작업허가서: 내부(1~3) → 시공사(GC) → 발주처(CM/SM) */
export const WORK_PERMIT_APPROVAL_STEPS: DefaultStep[] = [
  { label: '협력사 관리감독자 (상신)', position: 'contractor_supervisor' },
  { label: '협력사 안전관리자 (검토)', position: 'contractor_safety_manager' },
  { label: '협력사 현장소장 (승인)', position: 'contractor_site_director' },
  { label: '시공사 관리자', position: 'gc_manager' },
  { label: '발주처 CM (검토)', position: 'owner_cm' },
  { label: '발주처 SM (승인)', position: 'owner_sm' },
];

/** 엔티티 → 기본 결재선 */
export const DEFAULT_STEPS_BY_ENTITY: Record<ApprovalEntityType, DefaultStep[]> = {
  work_permit: WORK_PERMIT_APPROVAL_STEPS,
  work_plan: FIXED_APPROVAL_STEPS,
  assessment_run: FIXED_APPROVAL_STEPS,
  safety_cost: FIXED_APPROVAL_STEPS,
  incident: FIXED_APPROVAL_STEPS,
  emergency_drill: FIXED_APPROVAL_STEPS,
  tbm: FIXED_APPROVAL_STEPS,
};

export const APPROVAL_POLICY = {
  requireResubmitReason: true,
  requireRejectComment: true,
  notifyAuthorOnFinalApproval: true,
  allowDelegation: true,
  allowCancelAndResubmit: true,
  enforceFixedOrder: true,
  allowCooperationAfterFinal: true,
} as const;

export const buildDefaultSteps = (entityType: ApprovalEntityType) =>
  DEFAULT_STEPS_BY_ENTITY[entityType].map((s) => ({
    label: s.label,
    position: s.position,
    user_id: '',
    user_name: '',
    company_id: null as string | null,
    company_name: '',
  }));

/**
 * 기안자 회사 유형에 맞춘 기본 결재선.
 * - 시공사(gc) 기안: 내부 1~3 라벨 「시공사 …」, GC 확인(4단계) 생략
 * - 협력사 기안: 전체 위계 유지
 */
export function buildDefaultStepsForAuthor(
  entityType: ApprovalEntityType,
  authorCompanyType: CompanyTypeCode | string | null | undefined,
) {
  const t = normalizeCompanyType(authorCompanyType);
  let base = DEFAULT_STEPS_BY_ENTITY[entityType];
  if (entityType === 'work_permit' && t === 'gc') {
    base = base.filter((s) => !['gc', 'gc_manager', 'gc_pm'].includes(s.position));
  }
  return base.map((s) => ({
    label: stepLabelForAuthor(s.position, t),
    position: s.position,
    user_id: '',
    user_name: '',
    company_id: null as string | null,
    company_name: '',
  }));
}

/**
 * 단계별 결재자 후보 필터.
 * get_eligible_approvers RPC 가 돌려주는 { out_company_type, out_position, out_role }
 * 를 기준으로 UI 드롭다운을 좁힌다.
 */
export interface EligibleApprover {
  out_user_id: string;
  out_display_name: string;
  out_company_id: string | null;
  out_company_name: string;
  out_company_type: string; // client|gc|contractor|vendor
  out_position: string;     // e.g. SITE_MANAGER, HSE_MANAGER, OWNER_PM ...
  out_role: string;
}

const POS = (p: string) => (p || '').toUpperCase();

/**
 * SSOT 결재 단계 키 화이트리스트.
 *   - contractor_*  : 기안자 회사 내부 (company_id 일치) + 직책 화이트리스트
 *   - gc / gc_*     : 시공사(company_type=gc)
 *   - owner_cm/sm   : 발주처(company_type=client) + CM/SM 직책
 *   - cooperator    : 협조
 */
export const SSOT_STEP_KEYS = new Set<string>([
  'contractor_supervisor',
  'contractor_safety_manager',
  'contractor_site_director',
  'gc',
  'gc_manager',
  'gc_pm',
  'owner_cm',
  'owner_sm',
  'cooperator',
]);

const CONTRACTOR_STEP_KEYS = new Set<string>([
  'contractor_supervisor',
  'contractor_safety_manager',
  'contractor_site_director',
]);
const GC_STEP_KEYS = new Set<string>(['gc', 'gc_manager', 'gc_pm']);
const CLIENT_STEP_KEYS = new Set<string>(['owner_cm', 'owner_sm']);

/** Step key → allowed project_position codes (strict). */
export const STEP_POSITION_ALLOWLIST: Record<string, string[]> = {
  // 상신(관리감독자): SITE_SUPERVISOR 우선. 현장 직책이 비어 있는 업체를 위해
  // 공사/현장 관리 직책도 허용(없으면 상신 버튼이 영구 비활성됨).
  contractor_supervisor: [
    'SITE_SUPERVISOR',
    'FOREMAN',
    'FIELD_ENGINEER',
    'CONSTRUCTION_MGR',
    'SITE_MANAGER',
    'HSE_MANAGER',
    'CEO',
    'EXECUTIVE',
  ],
  contractor_safety_manager: ['HSE_MANAGER'],
  contractor_site_director: ['SITE_MANAGER'],
  gc_manager: ['SITE_MANAGER', 'HSE_MANAGER', 'CONSTRUCTION_MGR', 'CEO', 'EXECUTIVE'],
  gc_pm: ['SITE_MANAGER', 'CONSTRUCTION_MGR', 'CEO', 'EXECUTIVE'],
  gc: ['SITE_MANAGER', 'HSE_MANAGER', 'CONSTRUCTION_MGR', 'CEO', 'EXECUTIVE'],
  owner_cm: ['OWNER_CM', 'OWNER_PM'],
  owner_sm: ['OWNER_SM', 'OWNER_HSE'],
};

/** Fallback when position_new empty: match project_role */
const STEP_ROLE_FALLBACK: Record<string, string[]> = {
  contractor_supervisor: [
    'site_supervisor',
    'supervisor',
    'project_admin',
    'site_manager',
    'safety_manager',
  ],
  contractor_safety_manager: ['safety_manager'],
  contractor_site_director: ['site_manager'],
  gc_manager: ['project_admin', 'safety_manager', 'site_manager'],
  gc_pm: ['project_admin', 'site_manager'],
  gc: ['project_admin', 'safety_manager', 'site_manager'],
  owner_cm: ['project_admin'],
  owner_sm: ['safety_manager'],
};

function isWorkerApprover(a: EligibleApprover): boolean {
  const pos = POS(a.out_position);
  const role = (a.out_role || '').toLowerCase();
  return pos === 'WORKER' || role === 'worker' || role === 'partner_worker' || role === 'viewer';
}

/**
 * 레거시 단계 키(구형 project_role/position)를 SSOT 단계 키로 매핑.
 */
export function remapLegacyStepKey(
  legacyKey: string,
  ctx?: { companyType?: string | null },
): string | null {
  const k = (legacyKey || '').toLowerCase();
  if (SSOT_STEP_KEYS.has(k)) return k;
  const t = normalizeCompanyType(ctx?.companyType) || '';
  const isClient = t === 'client';
  const isGc = t === 'gc';
  const isContractor = t === 'contractor' || t === 'vendor';
  switch (k) {
    case 'supervisor':
    case 'contractor_pic':
    case 'site_supervisor':
      return 'contractor_supervisor';
    case 'safety_manager':
    case 'hse_manager':
      if (isClient) return 'owner_sm';
      if (isGc) return 'gc_manager';
      if (isContractor) return 'contractor_safety_manager';
      return null;
    case 'site_manager':
    case 'site_director':
      if (isClient) return 'owner_cm';
      if (isGc) return 'gc_manager';
      if (isContractor) return 'contractor_site_director';
      return null;
    case 'project_admin':
    case 'cm':
      if (isGc) return 'gc_manager';
      return 'owner_cm';
    case 'owner_pm':
    case 'owner_cm':
      return 'owner_cm';
    case 'sm':
    case 'owner_hse':
    case 'owner_sm':
      return 'owner_sm';
    case 'cooperator':
      return 'cooperator';
    default:
      return null;
  }
}

/** 템플릿/저장된 단계를 기안자 유형에 맞게 라벨·GC단계 생략 적용 */
export function adaptStepsForAuthor<T extends { label: string; position: string }>(
  steps: T[],
  authorCompanyType: CompanyTypeCode | string | null | undefined,
): T[] {
  const t = normalizeCompanyType(authorCompanyType);
  let next = steps.map((s) => {
    const key = remapLegacyStepKey(s.position, { companyType: t }) || s.position;
    return {
      ...s,
      position: key,
      label: stepLabelForAuthor(key, t),
    };
  });
  if (t === 'gc') {
    next = next.filter((s) => !GC_STEP_KEYS.has((s.position || '').toLowerCase()));
  }
  return next;
}

function matchesStepPosition(a: EligibleApprover, stepKey: string): boolean {
  const allow = STEP_POSITION_ALLOWLIST[stepKey];
  if (!allow || allow.length === 0) return true;
  const pos = POS(a.out_position);
  if (pos && allow.includes(pos)) return true;
  // position missing → role fallback (narrow)
  if (!pos) {
    const roles = STEP_ROLE_FALLBACK[stepKey] || [];
    return roles.includes((a.out_role || '').toLowerCase());
  }
  return false;
}

/**
 * 단계별 결재자 후보 필터 (회사 유형 + 직책 이중 필터).
 *
 * CASE A 협력사 기안 / CASE B 시공사 기안 공통:
 *   contractor_* → authorCompanyId 일치 + 직책 화이트리스트
 *   (시공사 직영도 동일: 기안자 회사 내부만)
 * gc_* → company_type=gc (시공사 기안 시 이 단계는 adaptSteps에서 생략)
 * owner_cm/sm → company_type=client + OWNER_CM/SM
 */
export interface ApproverFilterContext {
  /** 문서 기안자(또는 문서 귀속) 회사 id */
  authorCompanyId?: string | null;
  /** 기안자 회사 유형 client|gc|contractor|vendor */
  authorCompanyType?: string | null;
}

export function filterApproversForStep(
  approvers: EligibleApprover[],
  stepPosition: string,
  ctx?: ApproverFilterContext,
): EligibleApprover[] {
  const rawKey = (stepPosition || '').toLowerCase();
  const key =
    remapLegacyStepKey(rawKey, { companyType: ctx?.authorCompanyType }) || rawKey;
  if (!SSOT_STEP_KEYS.has(key)) return [];

  const authorCompanyId = ctx?.authorCompanyId ?? null;
  const authorType = normalizeCompanyType(ctx?.authorCompanyType);

  // 시공사 기안 시 GC 확인 단계는 목록 비움 (UI에서 단계 자체 생략 권장)
  if (authorType === 'gc' && GC_STEP_KEYS.has(key)) {
    return [];
  }

  const strict = approvers.filter((a) => {
    const t = normalizeCompanyType(a.out_company_type);

    if (CONTRACTOR_STEP_KEYS.has(key)) {
      if (!authorCompanyId) return false;
      if (!a.out_company_id || a.out_company_id !== authorCompanyId) return false;
      return matchesStepPosition(a, key);
    }

    if (GC_STEP_KEYS.has(key)) {
      if (t !== 'gc') return false;
      // 시공사 단계: 기안자가 협력사이면 GC 전원 중 직책 일치만
      return matchesStepPosition(a, key);
    }

    if (CLIENT_STEP_KEYS.has(key)) {
      if (t !== 'client') return false;
      return matchesStepPosition(a, key);
    }

    if (key === 'cooperator') return true;
    return false;
  });

  if (strict.length > 0) return strict;

  // Soft fallback — 관리감독자(상신) 슬롯에 SITE_SUPERVISOR가 없으면
  // 기안 회사의 비근로자 멤버라도 선택 가능해야 결재상신이 막히지 않는다.
  if (key === 'contractor_supervisor' && authorCompanyId) {
    return approvers.filter(
      (a) => a.out_company_id === authorCompanyId && !isWorkerApprover(a),
    );
  }

  return strict;
}


/** 결재선 전체 검증 — 하나라도 비-SSOT 키가 있으면 실패 사유 반환 */
export function validateApprovalLinesSSOT(
  lines: Array<{ position?: string | null; step_label?: string | null }>,
): { ok: boolean; invalid: string[] } {
  const invalid = lines
    .map((l) => (l.position || '').toLowerCase())
    .filter((p) => !SSOT_STEP_KEYS.has(p));
  return { ok: invalid.length === 0, invalid };
}

/**
 * 위계(발주처-시공사-협력사) 강제 정렬용 랭크.
 * 실제 프로세스 순서: 협력사 → 시공사(GC) → 발주처(Client) → 협조.
 * 값이 작을수록 앞 단계. 알 수 없는 키는 99(맨 뒤)로 취급하지만 UI/RPC에서 차단된다.
 */
export const POSITION_RANK: Record<string, number> = {
  contractor_supervisor: 10,
  contractor_safety_manager: 11,
  contractor_site_director: 12,
  gc: 20,
  gc_manager: 21,
  gc_pm: 22,
  owner_cm: 30,
  owner_sm: 31,
  cooperator: 40,
};

export function positionRank(pos?: string | null): number {
  const k = (pos || '').toLowerCase();
  return POSITION_RANK[k] ?? 99;
}

/**
 * 결재선을 위계(협력사 → 시공사 → 발주처 → 협조) 순으로 안정 정렬한다.
 * 동일 랭크(예: contractor_supervisor 3명) 내에서는 입력 순서 유지.
 * 발주처 SM(owner_sm)은 항상 마지막 단계로 밀린다.
 */
export function sortStepsByHierarchy<T extends { position?: string | null }>(steps: T[]): T[] {
  return steps
    .map((s, idx) => ({ s, idx, r: positionRank(s.position) }))
    .sort((a, b) => (a.r - b.r) || (a.idx - b.idx))
    .map((x) => x.s);
}

/**
 * 결재선 위계 검증. 랭크가 감소하는 순간(발주처 뒤에 협력사 등)이 있으면 fail.
 */
export function validateStepsHierarchy<T extends { position?: string | null; label?: string | null }>(
  steps: T[],
): { ok: boolean; message?: string } {
  let prev = -Infinity;
  for (let i = 0; i < steps.length; i++) {
    const r = positionRank(steps[i].position);
    if (r === 99) {
      return {
        ok: false,
        message: `${i + 1}단계(${steps[i].label || steps[i].position || '-'}): 알 수 없는 결재 직책입니다.`,
      };
    }
    if (r < prev) {
      return {
        ok: false,
        message:
          `결재 단계 순서가 위계(협력사 → 시공사 → 발주처)를 어기고 있습니다. ` +
          `${i + 1}단계(${steps[i].label || steps[i].position})가 이전 단계보다 상위입니다.`,
      };
    }
    prev = r;
  }
  return { ok: true };
}


