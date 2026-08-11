import type { ApprovalEntityType } from '@/lib/approvalRules';

/**
 * 전자결재 플랫폼 — 모듈(entity)별 결재 정책.
 * 소비 모듈은 여기 등록된 정책만 사용한다.
 * work_permit 은 현재 자체 UI/경로를 유지하므로 플랫폼 상신에 연결하지 않는다.
 */
export type EntityApprovalPolicy = {
  /** 플랫폼 draft 저장·상신 사용 여부 */
  usesPlatformDraft: boolean;
  /** 최소 단계 수 */
  minSteps: number;
  /** 발주처 CM 또는 SM 필수 */
  requireOwnerClientStep: boolean;
  /** CM 없이 SM만 허용 */
  allowOwnerSmOnly: boolean;
  /** 비고 (문서용) */
  note?: string;
};

export const ENTITY_APPROVAL_POLICIES: Record<ApprovalEntityType, EntityApprovalPolicy> = {
  assessment_run: {
    usesPlatformDraft: true,
    minSteps: 3,
    requireOwnerClientStep: true,
    allowOwnerSmOnly: true,
    note: '위평 — 결재선 저장과 상신 분리 (파일럿)',
  },
  assessment_run_feedback: {
    usesPlatformDraft: false,
    minSteps: 2,
    requireOwnerClientStep: false,
    allowOwnerSmOnly: true,
    note: '추후 플랫폼 연결',
  },
  work_plan: {
    usesPlatformDraft: false,
    minSteps: 2,
    requireOwnerClientStep: false,
    allowOwnerSmOnly: true,
    note: '추후 플랫폼 연결',
  },
  work_permit: {
    usesPlatformDraft: false,
    minSteps: 5,
    requireOwnerClientStep: true,
    allowOwnerSmOnly: false,
    note: '허가서 — 현행 SubmitApprovalDialog/submit_approval 경로 유지. 플랫폼 미연결.',
  },
  safety_cost: {
    usesPlatformDraft: false,
    minSteps: 2,
    requireOwnerClientStep: false,
    allowOwnerSmOnly: true,
    note: '산안비 전용 테이블 유지',
  },
  incident: {
    usesPlatformDraft: false,
    minSteps: 2,
    requireOwnerClientStep: false,
    allowOwnerSmOnly: true,
  },
  emergency_drill: {
    usesPlatformDraft: false,
    minSteps: 2,
    requireOwnerClientStep: false,
    allowOwnerSmOnly: true,
  },
  tbm: {
    usesPlatformDraft: false,
    minSteps: 2,
    requireOwnerClientStep: false,
    allowOwnerSmOnly: true,
  },
};

export function getEntityApprovalPolicy(entityType: string): EntityApprovalPolicy {
  return (
    ENTITY_APPROVAL_POLICIES[entityType as ApprovalEntityType] || {
      usesPlatformDraft: false,
      minSteps: 2,
      requireOwnerClientStep: false,
      allowOwnerSmOnly: true,
    }
  );
}
