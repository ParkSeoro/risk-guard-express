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
  | 'assessment_run_feedback'
  | 'work_plan'
  | 'work_permit'
  | 'safety_cost'
  | 'incident'
  | 'emergency_drill'
  | 'tbm';

export const ENTITY_LABELS: Record<ApprovalEntityType, string> = {
  assessment_run: '위험성평가',
  assessment_run_feedback: '위험성평가 피드백(조치)',
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
  // Work-permit stamp vocabulary (DigPermitForm) — keep in sync with paper headers
  contractor_supervisor: '담당자(시공)',
  contractor_safety_manager: '담당자(안전)',
  contractor_site_director: '책임자(소장)',
  gc: '시공사',
  gc_manager: '시공사 관리자',
  gc_pm: '시공사 PM',
  owner_cm: '담당자(CM)',
  owner_sm: '담당자(SM)',
  cooperator: '협조부서',

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

/**
 * Step display label aligned with permit stamp headers.
 * Does NOT change POSITION_TO_SIG / approval→stamp slot mapping.
 * Renaming a step in the UI still does not rewrite DigPermitForm headers.
 */
export function stepLabelForAuthor(
  positionKey: string,
  _authorCompanyType?: CompanyTypeCode | string | null | undefined,
): string {
  switch ((positionKey || '').toLowerCase()) {
    case 'contractor_supervisor':
    case 'contractor_pic':
      return '담당자(시공)';
    case 'contractor_safety_manager':
    case 'safety_pic':
      return '담당자(안전)';
    case 'contractor_site_director':
    case 'site_director':
      return '책임자(소장)';
    case 'gc_manager':
    case 'gc':
    case 'gc_pm':
      return '시공사 관리자';
    case 'owner_cm':
    case 'cm':
      return '담당자(CM)';
    case 'owner_sm':
    case 'sm':
      return '담당자(SM)';
    case 'cooperator':
      return '협조부서';
    default:
      return POSITION_LABELS[positionKey] || positionKey || '결재';
  }
}

export interface DefaultStep {
  label: string;
  position: ApprovalPositionKey | string;
}

/** 기본 5단계 고정 결재선 (위평/계획서 등) */
export const FIXED_APPROVAL_STEPS: DefaultStep[] = [
  { label: '담당자(시공)', position: 'contractor_supervisor' },
  { label: '담당자(안전)', position: 'contractor_safety_manager' },
  { label: '책임자(소장)', position: 'contractor_site_director' },
  { label: '담당자(CM)', position: 'owner_cm' },
  { label: '담당자(SM)', position: 'owner_sm' },
];

/**
 * 작업허가서 기본 결재선 — 양식 서명란과 동일 명칭.
 * 시공사 관리자(gc_manager) 단계 없음.
 * 회사 범위: 시공=기안사 / 안전·소장=GC / CM·SM=발주처 (filterApproversForStep).
 */
export const WORK_PERMIT_APPROVAL_STEPS: DefaultStep[] = [
  { label: '담당자(시공)', position: 'contractor_supervisor' },
  { label: '담당자(안전)', position: 'contractor_safety_manager' },
  { label: '책임자(소장)', position: 'contractor_site_director' },
  { label: '담당자(CM)', position: 'owner_cm' },
  { label: '담당자(SM)', position: 'owner_sm' },
];

/** 엔티티 → 기본 결재선 */
export const DEFAULT_STEPS_BY_ENTITY: Record<ApprovalEntityType, DefaultStep[]> = {
  work_permit: WORK_PERMIT_APPROVAL_STEPS,
  work_plan: FIXED_APPROVAL_STEPS,
  assessment_run: FIXED_APPROVAL_STEPS,
  assessment_run_feedback: FIXED_APPROVAL_STEPS,
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
  // SSOT: 관리감독자(상신) = SITE_SUPERVISOR
  contractor_supervisor: ['SITE_SUPERVISOR'],
  contractor_safety_manager: ['HSE_MANAGER'],
  contractor_site_director: ['SITE_MANAGER'],
  gc_manager: ['SITE_MANAGER', 'HSE_MANAGER', 'CONSTRUCTION_MGR', 'CEO', 'EXECUTIVE'],
  gc_pm: ['SITE_MANAGER', 'CONSTRUCTION_MGR', 'CEO', 'EXECUTIVE'],
  gc: ['SITE_MANAGER', 'HSE_MANAGER', 'CONSTRUCTION_MGR', 'CEO', 'EXECUTIVE'],
  owner_cm: ['OWNER_CM', 'OWNER_PM'],
  owner_sm: ['OWNER_SM', 'OWNER_HSE'],
};

/**
 * Role match for a step. Applied even when position_new is set so
 * drift (role=site_supervisor + position=CONSTRUCTION_MGR) still qualifies
 * for 관리감독자(상신). Keep this list tight to the canonical role.
 */
const STEP_ROLE_FALLBACK: Record<string, string[]> = {
  contractor_supervisor: ['site_supervisor'],
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
  const role = (a.out_role || '').toLowerCase();
  const roles = STEP_ROLE_FALLBACK[stepKey] || [];
  if (pos && allow.includes(pos)) return true;
  // Role match even when position_new is set (guards role/position drift)
  if (roles.includes(role)) return true;
  return false;
}

/**
 * 단계별 결재자 후보 필터 (회사 범위 + 직책).
 *
 * Work-permit stamp alignment:
 *   contractor_supervisor      → 기안사(작성 회사) only — 담당자(시공)
 *   contractor_safety_manager  → 시공사(GC) — 담당자(안전)
 *   contractor_site_director   → 시공사(GC) — 책임자(소장)
 *   owner_cm / owner_sm        → 발주처(client)
 *   gc_*                       → 시공사 (레거시 단계; 기본 결재선에서는 제거)
 *
 * Soft fallback: 직책 미스 시 같은 회사 범위의 비근로자 관리자까지 허용.
 * POSITION_TO_SIG 키는 변경하지 않음.
 */
export interface ApproverFilterContext {
  /** 문서 기안자(또는 문서 귀속) 회사 id */
  authorCompanyId?: string | null;
  /** 기안자 회사 유형 client|gc|contractor|vendor */
  authorCompanyType?: string | null;
}

/** 안전·소장 단계는 양식상 시공사 칸 — GC 범위 */
const GC_SCOPED_PERMIT_STEPS = new Set<string>([
  'contractor_safety_manager',
  'contractor_site_director',
]);

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

  // 시공사 기안 시 레거시 GC 확인 단계는 목록 비움 (기본 결재선에도 없음)
  if (authorType === 'gc' && GC_STEP_KEYS.has(key)) {
    return [];
  }

  const inAuthorCompany = (a: EligibleApprover) =>
    !!authorCompanyId && a.out_company_id === authorCompanyId;
  const inGc = (a: EligibleApprover) => normalizeCompanyType(a.out_company_type) === 'gc';
  const inClient = (a: EligibleApprover) => normalizeCompanyType(a.out_company_type) === 'client';

  const strict = approvers.filter((a) => {
    if (key === 'contractor_supervisor') {
      if (!inAuthorCompany(a)) return false;
      return matchesStepPosition(a, key);
    }

    if (GC_SCOPED_PERMIT_STEPS.has(key)) {
      if (!inGc(a)) return false;
      return matchesStepPosition(a, key);
    }

    if (GC_STEP_KEYS.has(key)) {
      if (!inGc(a)) return false;
      return matchesStepPosition(a, key);
    }

    if (CLIENT_STEP_KEYS.has(key)) {
      if (!inClient(a)) return false;
      return matchesStepPosition(a, key);
    }

    if (key === 'cooperator') return true;
    return false;
  });

  if (strict.length > 0) return strict;

  // Soft fallback within the same company scope (never cross partner↔GC↔client).
  if (key === 'contractor_supervisor' && authorCompanyId) {
    return approvers.filter((a) => inAuthorCompany(a) && !isWorkerApprover(a));
  }
  if (GC_SCOPED_PERMIT_STEPS.has(key) || GC_STEP_KEYS.has(key)) {
    return approvers.filter((a) => inGc(a) && !isWorkerApprover(a));
  }
  if (CLIENT_STEP_KEYS.has(key)) {
    return approvers.filter((a) => inClient(a) && !isWorkerApprover(a));
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

/** 상신(기안) 단계 — 승인/반려 대상이 아님 */
export function isSubmitterApprovalStep(step: {
  position?: string | null;
  step?: string | null;
  step_label?: string | null;
  step_position?: string | null;
  step_order?: number | null;
}): boolean {
  const pos = (step.position || step.step_position || '').toLowerCase();
  if (pos === 'contractor_supervisor' || pos === 'contractor_pic') return true;
  const label = `${step.step || ''}${step.step_label || ''}`;
  if (label.includes('상신')) return true;
  // Stamp-aligned default label (no longer contains 「상신」)
  if (label.includes('담당자(시공)')) return true;
  return false;
}

/**
 * Remove duplicate nodes on one approval line (same position+user, or twin org-labeled copies).
 * Keeps first occurrence in hierarchy order.
 */
export function dedupeApprovalSteps<
  T extends { position?: string | null; user_id?: string | null },
>(steps: T[]): T[] {
  const seenPosUser = new Set<string>();
  const out: T[] = [];
  for (const s of steps) {
    const uid = s.user_id || '';
    const pos = (s.position || '').toLowerCase();
    if (!pos || !uid) {
      out.push(s);
      continue;
    }
    const key = `${pos}:${uid}`;
    if (seenPosUser.has(key)) continue;
    seenPosUser.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Group key for Approvals UI — never dump all entity docs into one "general" bucket.
 */
export function approvalTimelineGroupKey(ap: {
  run_id?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  id?: string;
}): string {
  if (ap.run_id) return `run:${ap.run_id}`;
  if (ap.entity_type && ap.entity_id) return `${ap.entity_type}:${ap.entity_id}`;
  return `orphan:${ap.id || 'unknown'}`;
}

/**
 * Sequential display status: a later step cannot look "완료" unless all prior steps are 승인.
 * Corrupted / mixed-line data is forced back to 대기 for rendering.
 */
export function sequentialDisplayStatus(
  steps: Array<{ step_order?: number | null; status?: string | null }>,
  step: { step_order?: number | null; status?: string | null },
): string {
  const order = step.step_order ?? 99;
  const raw = step.status || '대기';
  if (raw !== '승인' && raw !== '반려') return raw;
  const priors = steps.filter((s) => (s.step_order ?? 99) < order);
  const blocked = priors.some((s) => s.status !== '승인' && s.status !== '취소');
  if (blocked && raw === '승인') return '대기';
  return raw;
}


