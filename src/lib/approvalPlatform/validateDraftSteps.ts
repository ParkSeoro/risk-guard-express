import { validateApprovalLinesSSOT, validateSafetyCostApprovalSteps, validateStepsHierarchy } from '@/lib/approvalRules';
import { getEntityApprovalPolicy } from './entityPolicies';
import type { ApprovalDraftStep } from './types';

export type DraftValidation = {
  ok: boolean;
  errors: string[];
  ready: boolean;
};

/** 클라이언트 측 draft 검증 — 서버 validate_approval_draft_steps 와 정합 */
export function validateDraftSteps(
  entityType: string,
  steps: ApprovalDraftStep[],
): DraftValidation {
  const policy = getEntityApprovalPolicy(entityType);
  const errors: string[] = [];

  if (!steps || steps.length < policy.minSteps) {
    errors.push(`결재 단계는 ${policy.minSteps}개 이상이어야 합니다.`);
  }

  const seen = new Set<string>();
  steps.forEach((s, i) => {
    const label = s.label || s.position || `${i + 1}단계`;
    if (!s.position) errors.push(`${label}: position 없음`);
    if (!s.user_id) errors.push(`${label}: 결재자 미지정`);
    if (s.position && s.user_id) {
      const key = `${s.position.toLowerCase()}:${s.user_id}`;
      if (seen.has(key)) errors.push(`${label}: 동일 결재자·직책 중복`);
      else seen.add(key);
    }
  });

  if (policy.requireOwnerClientStep) {
    const hasClient = steps.some((s) => {
      const p = (s.position || '').toLowerCase();
      return p === 'owner_cm' || p === 'owner_sm' || p === 'cm' || p === 'sm';
    });
    if (!hasClient) {
      errors.push(
        policy.allowOwnerSmOnly
          ? '발주처(CM/SM) 단계가 필요합니다. (SM만 있어도 됩니다)'
          : '발주처 CM·SM 단계가 필요합니다.',
      );
    }
  }

  const ssot = validateApprovalLinesSSOT(
    steps.map((s, i) => ({
      step_order: i,
      step_label: s.label,
      position: s.position,
      user_id: s.user_id,
    })) as any,
  );
  if (!ssot.ok) {
    errors.push(`구형 단계 키: ${Array.from(new Set(ssot.invalid)).join(', ')}`);
  }

  const hierarchy = entityType === 'safety_cost'
    ? validateSafetyCostApprovalSteps(
        steps.map((s) => ({
          label: s.label,
          position: s.position,
        })),
      )
    : validateStepsHierarchy(
        steps.map((s) => ({
          label: s.label,
          position: s.position,
          user_id: s.user_id,
          user_name: s.user_name,
          company_id: s.company_id,
          company_name: s.company_name,
        })),
      );
  if (!hierarchy.ok && hierarchy.message) {
    errors.push(hierarchy.message);
  }

  const ok = errors.length === 0;
  return { ok, errors, ready: ok };
}
