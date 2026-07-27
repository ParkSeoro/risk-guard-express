/**
 * 전자결재 SSOT (Single Source of Truth)
 * ------------------------------------------------------------------
 * 모든 안전 서류(작업허가서, 위험성평가, 작업계획서, 산업안전보건관리비,
 * 사고보고, 비상대피훈련, TBM 일지 등)는 아래 5단계 고정 결재선을
 * 강제 사용한다.
 *
 * Step 1. 협력사 관리감독자     (작성/상신)   position = contractor_supervisor
 * Step 2. 협력사 안전관리자     (검토)        position = contractor_safety_manager
 * Step 3. 협력사 현장소장       (협력사 최종) position = contractor_site_director
 * Step 4. 발주처 CM             (공사관리)    position = owner_cm
 * Step 5. 발주처 SM             (안전 최종)   position = owner_sm
 *
 * 확장: Step 5 이후 협조(Cooperation) 단계를 순차/병렬로 추가 가능하다.
 *      position = cooperator (또는 회사 정책에 맞춰 세분화)
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

/** 5단계 고정 결재선 포지션 키 + 협조 슬롯 */
export type ApprovalPositionKey =
  | 'contractor_supervisor'
  | 'contractor_safety_manager'
  | 'contractor_site_director'
  | 'owner_cm'
  | 'owner_sm'
  | 'cooperator';

export const POSITION_LABELS: Record<string, string> = {
  contractor_supervisor: '협력사 관리감독자',
  contractor_safety_manager: '협력사 안전관리자',
  contractor_site_director: '협력사 현장소장',
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

export interface DefaultStep {
  label: string;
  position: ApprovalPositionKey | string;
}

/** 모든 엔티티에 강제 적용되는 5단계 고정 결재선 */
export const FIXED_APPROVAL_STEPS: DefaultStep[] = [
  { label: '협력사 관리감독자 (상신)', position: 'contractor_supervisor' },
  { label: '협력사 안전관리자 (검토)', position: 'contractor_safety_manager' },
  { label: '협력사 현장소장 (승인)', position: 'contractor_site_director' },
  { label: '발주처 CM (공사관리)', position: 'owner_cm' },
  { label: '발주처 SM (안전 최종승인)', position: 'owner_sm' },
];

/** 엔티티 → 기본 결재선 (모두 동일한 5단계 고정) */
export const DEFAULT_STEPS_BY_ENTITY: Record<ApprovalEntityType, DefaultStep[]> = {
  work_permit: FIXED_APPROVAL_STEPS,
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
  /** 5단계 순서 강제 (드롭다운 필터링) */
  enforceFixedOrder: true,
  /** Step 5 이후 협조 단계 추가 허용 */
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

const CONTRACTOR_TYPES = new Set(['contractor', 'vendor']);
const CLIENT_TYPES = new Set(['client']);
const GC_TYPES = new Set(['gc']);
// 발주처(넓은 의미) — legacy 매핑 용도로만 남겨둠. 필터에는 직접 사용하지 않는다.
const OWNER_TYPES = new Set(['client', 'gc']);

const POS = (p: string) => (p || '').toUpperCase();

/**
 * SSOT 결재 단계 키 화이트리스트.
 * 실제 위계: 발주처(client) → 시공사(gc) → 협력사(contractor)
 *   - contractor_*  : 협력사 (작성자 회사 = 정확한 company_id 일치자만)
 *   - gc / gc_*     : 시공사 (해당 프로젝트에 등록된 GC 전원)
 *   - owner_cm, owner_sm : 발주처 (company.type='client' 인 사람만)
 *   - cooperator    : 협조 슬롯 (Step 5 이후)
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

/**
 * 레거시 단계 키(구형 project_role/position)를 SSOT 단계 키로 매핑.
 * 회사 타입을 알 수 없어 분기가 불가능한 경우 null을 돌려 상위에서 차단한다.
 */
export function remapLegacyStepKey(
  legacyKey: string,
  ctx?: { companyType?: string | null },
): string | null {
  const k = (legacyKey || '').toLowerCase();
  if (SSOT_STEP_KEYS.has(k)) return k;
  const t = (ctx?.companyType || '').toLowerCase();
  const isClient = CLIENT_TYPES.has(t);
  const isGc = GC_TYPES.has(t);
  const isContractor = CONTRACTOR_TYPES.has(t);
  switch (k) {
    case 'supervisor':
    case 'contractor_pic':
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
      return 'owner_cm';
    case 'sm':
    case 'owner_hse':
      return 'owner_sm';
    case 'cooperator':
      return 'cooperator';
    default:
      return null;
  }
}

/**
 * 단계별 결재자 후보 필터 (실제 위계 반영 최종 버전).
 *
 * 규칙:
 *  1. contractor_* : 반드시 `ctx.authorCompanyId` 와 정확히 일치하는 협력사 소속자만.
 *                    (작성자 회사의 관리감독자/안전관리자/소장 노출 누락 문제 해결)
 *                    authorCompanyId 가 없거나 후보 회사와 다르면 제외한다.
 *  2. gc / gc_*    : 해당 프로젝트에 등록된 시공사(company_type='gc') 소속 전원 노출.
 *                    직급/포지션 필터를 걸지 않는다.
 *  3. owner_cm / owner_sm : 반드시 company_type='client' 인 사람만 노출.
 *                    (하청/시공사 소속 인원 진입 금지)
 *  4. cooperator   : 협조 슬롯 — 프로젝트 소속이면 전원.
 *  5. 그 외(알 수 없는 step_key) : 무조건 빈 배열 반환 (기본 통과 로직 폐기).
 */
export interface ApproverFilterContext {
  /** 문서 기안자(또는 대상 협력사)의 company_id */
  authorCompanyId?: string | null;
}

export function filterApproversForStep(
  approvers: EligibleApprover[],
  stepPosition: string,
  ctx?: ApproverFilterContext,
): EligibleApprover[] {
  const key = (stepPosition || '').toLowerCase();
  // 방어벽: SSOT 키가 아니면 무조건 빈 배열
  if (!SSOT_STEP_KEYS.has(key)) return [];

  const authorCompanyId = ctx?.authorCompanyId ?? null;

  return approvers.filter((a) => {
    const t = (a.out_company_type || '').toLowerCase();
    const isContractorCo = CONTRACTOR_TYPES.has(t);
    const isClientCo = CLIENT_TYPES.has(t);
    const isGcCo = GC_TYPES.has(t);

    // 1) 협력사(=상신자 회사 내부) 3개 단계
    //    - 상신자 회사가 contractor/vendor 뿐 아니라 gc 인 경우도 있으므로
    //      회사 타입은 검사하지 않고, 오직 company_id 일치만 요구한다.
    //      (예: GC 소속 안전관리자가 허가서를 상신하는 실제 케이스)
    if (CONTRACTOR_STEP_KEYS.has(key)) {
      if (!authorCompanyId) return false; // 컨텍스트 미제공 시 안전하게 차단
      if (!a.out_company_id || a.out_company_id !== authorCompanyId) return false;
      return true; // 회사 일치 시 직급 무관 전원 노출 (누락 방지)
    }

    // 2) 시공사(GC) 단계 → GC 소속 전원 개방 (직급 무관)
    if (GC_STEP_KEYS.has(key)) {
      return isGcCo;
    }

    // 3) 발주처(client) 단계 → 반드시 client 소속만
    if (CLIENT_STEP_KEYS.has(key)) {
      return isClientCo;
    }

    // 4) 협조 단계 → 프로젝트 소속이면 전원
    if (key === 'cooperator') {
      return true;
    }

    // 5) 그 외 (도달 불가) → 차단
    return false;
  });
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

