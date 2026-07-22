/**
 * 전자결재 SSOT (Single Source of Truth)
 * ------------------------------------------------------------------
 * 전자결재가 필요한 모든 모듈(작업허가서, 작업계획서, 위험성평가,
 * 산업안전보건관리비, 사고보고, 비상대피훈련, TBM 일지 등)은
 * 이 파일의 규칙(엔티티 정의 / 기본 결재선 / 라벨 / 정책)을 따른다.
 *
 * 각 모듈은 자체적으로 결재 로직을 재정의하지 않고, 여기의
 * `ENTITY_LABELS`, `POSITION_LABELS`, `DEFAULT_STEPS_BY_ENTITY`,
 * `APPROVAL_POLICY` 만 참조한다.
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

export const POSITION_LABELS: Record<string, string> = {
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
  position: string;
}

/**
 * 엔티티별 기본 결재선. 프로젝트/회사/개인 템플릿이 없을 때 사용된다.
 * 작업허가서는 회사 정책(시공→안전→소장→CM→SM)에 따라 5단계가 기본.
 * 나머지는 안전관리자 1단계 검토가 기본이며, Settings > 결재선 관리에서
 * 프로젝트/회사 단위로 오버라이드 가능하다.
 */
export const DEFAULT_STEPS_BY_ENTITY: Record<ApprovalEntityType, DefaultStep[]> = {
  work_permit: [
    { label: '담당자(시공)', position: 'contractor_pic' },
    { label: '담당자(안전)', position: 'safety_pic' },
    { label: '책임자(소장)', position: 'site_director' },
    { label: '담당자(CM)', position: 'cm' },
    { label: '담당자(SM)', position: 'sm' },
  ],
  work_plan: [
    { label: '안전관리자 검토', position: 'safety_manager' },
    { label: '현장대리인 승인', position: 'site_manager' },
  ],
  assessment_run: [
    { label: '안전관리자 검토', position: 'safety_manager' },
    { label: '현장대리인 승인', position: 'site_manager' },
  ],
  safety_cost: [
    { label: '안전관리자 검토', position: 'safety_manager' },
    { label: '현장대리인 승인', position: 'site_manager' },
  ],
  incident: [
    { label: '안전관리자 검토', position: 'safety_manager' },
  ],
  emergency_drill: [
    { label: '안전관리자 검토', position: 'safety_manager' },
  ],
  tbm: [
    { label: '안전관리자 검토', position: 'safety_manager' },
  ],
};

/**
 * 전자결재 공통 정책.
 * 개별 모듈은 이 값을 참조해서 상신/재상신/위임/알림 동작을 결정한다.
 */
export const APPROVAL_POLICY = {
  /** 재상신 시 사유 입력 필수 여부 */
  requireResubmitReason: true,
  /** 반려 시 사유 입력 필수 여부 */
  requireRejectComment: true,
  /** 최종 승인 완료 시 작성자에게 알림 발송 */
  notifyAuthorOnFinalApproval: true,
  /** 위임(delegate_approval) 기본 허용 여부 */
  allowDelegation: true,
  /** 상신 후 대기 중 결재선 취소 후 재상신 허용 */
  allowCancelAndResubmit: true,
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
