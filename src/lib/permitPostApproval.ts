/** Classify special post-approval work-permit steps for UI labels. */
export type PermitPostStepKind =
  | 'closure_supervisor'
  | 'closure_sm'
  | 'extend_sm'
  | 'normal';

export function permitPostStepKind(position?: string | null): PermitPostStepKind {
  const p = (position || '').toLowerCase();
  if (p === 'closure_supervisor') return 'closure_supervisor';
  if (p === 'closure_sm') return 'closure_sm';
  if (p === 'extend_sm') return 'extend_sm';
  return 'normal';
}

export function permitPostStepBadge(kind: PermitPostStepKind): string | null {
  if (kind === 'closure_supervisor') return '관리감독자 완료 확인';
  if (kind === 'closure_sm') return '발주처 SM 종료 승인';
  if (kind === 'extend_sm') return '작업허가 연장 승인';
  return null;
}

export function permitPostStepApproveLabel(kind: PermitPostStepKind): string {
  if (kind === 'closure_supervisor') return '완료 확인';
  if (kind === 'closure_sm') return '작업 완료 및 종료';
  if (kind === 'extend_sm') return '연장 승인';
  return '승인';
}
