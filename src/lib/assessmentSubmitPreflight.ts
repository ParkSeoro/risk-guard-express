/**
 * 위험성평가 결재 상신 사전점검 — 토스트를 하나씩 띄우기 전에 한 목록으로 보여 줌.
 */

export type AssessmentPreflightJump = 'items' | 'participation' | 'approval';

export type AssessmentPreflightItem = {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
  jump?: AssessmentPreflightJump;
};

export function buildAssessmentSubmitPreflight(opts: {
  itemCount: number;
  opinionRequired: boolean;
  healthRequired: boolean;
  opinions: number;
  healths: number;
  unreviewedAi: number;
  unreviewedHealth: number;
  /** Loaded approval_lines count (saved or in-memory) */
  approvalLineCount: number;
  missingApproverLabels?: string[];
  ssotInvalidKeys?: string[];
  /**
   * 전자결재 플랫폼 draft 가 ready 인지.
   * 지정되면 결재선 항목은 이 값으로 판정한다 (미저장 메모리 라인으로 상신 불가).
   */
  approvalDraftReady?: boolean;
  approvalDraftDetail?: string;
  authorUserId?: string | null;
  authorName?: string | null;
  currentUserId?: string | null;
}): { items: AssessmentPreflightItem[]; ready: boolean } {
  const items: AssessmentPreflightItem[] = [];

  const authorOk = !!opts.authorUserId;
  const submitterOk = !!opts.authorUserId && !!opts.currentUserId && opts.authorUserId === opts.currentUserId;
  items.push({
    id: 'author',
    label: '작성 주체(관리감독자·현장소장) 지정',
    ok: authorOk,
    detail: authorOk ? (opts.authorName || '지정됨') : '관리감독자 또는 현장소장을 지정하세요',
  });
  items.push({
    id: 'author_submitter',
    label: '상신자는 작성 주체',
    ok: submitterOk,
    detail: submitterOk
      ? '본인'
      : authorOk
        ? `작성 주체(${opts.authorName || '지정됨'})만 상신 가능`
        : '작성 주체 지정 후 해당 관리감독자·현장소장이 상신',
  });

  items.push({
    id: 'items',
    label: '위험성평가 항목 1건 이상',
    ok: opts.itemCount > 0,
    detail: opts.itemCount > 0 ? `${opts.itemCount}건` : '항목을 추가하세요',
    jump: 'items',
  });

  if (opts.opinionRequired) {
    items.push({
      id: 'opinions',
      label: '근로자 의견 1건 이상',
      ok: opts.opinions > 0,
      detail: opts.opinions > 0 ? `${opts.opinions}건` : '근로자 참여에서 의견 등록',
      jump: 'participation',
    });
  }

  if (opts.healthRequired) {
    items.push({
      id: 'healths',
      label: '보건 유해요인 1건 이상',
      ok: opts.healths > 0,
      detail: opts.healths > 0 ? `${opts.healths}건` : '근로자 참여에서 보건 등록',
      jump: 'participation',
    });
  }

  const unreviewed = (opts.unreviewedAi || 0) + (opts.unreviewedHealth || 0);
  items.push({
    id: 'ai_review',
    label: 'AI 자동생성 항목 검토 완료',
    ok: unreviewed === 0,
    detail: unreviewed === 0 ? '완료' : `미검토 ${unreviewed}건`,
    jump: 'participation',
  });

  const missing = opts.missingApproverLabels || [];
  const ssotInvalid = opts.ssotInvalidKeys || [];
  const useDraftGate = typeof opts.approvalDraftReady === 'boolean';
  const linesOk = useDraftGate
    ? !!opts.approvalDraftReady
    : (
      // Fallback only when the page does not pass draft status.
      // Live SSOT is ENTITY_APPROVAL_POLICIES.assessment_run.minSteps (not this 2).
      opts.approvalLineCount >= 2
      && missing.length === 0
      && ssotInvalid.length === 0
    );

  let approvalDetail = opts.approvalDraftDetail
    || `${opts.approvalLineCount}단계`;
  if (useDraftGate) {
    approvalDetail = opts.approvalDraftReady
      ? (opts.approvalDraftDetail || `임시 저장 완료 · ${opts.approvalLineCount}단계`)
      : (opts.approvalDraftDetail || '결재선 [저장] 후 상신 가능');
  } else if (opts.approvalLineCount < 2) {
    approvalDetail = '결재선 [자동 생성] 후 [저장] 필요';
  } else if (ssotInvalid.length > 0) {
    approvalDetail = `구형 단계 키: ${Array.from(new Set(ssotInvalid)).join(', ')}`;
  } else if (missing.length > 0) {
    approvalDetail = `결재자 미지정: ${missing.join(', ')}`;
  }

  items.push({
    id: 'approval',
    label: useDraftGate ? '결재선 저장 완료 (상신 가능)' : '결재선 설정·결재자 지정',
    ok: linesOk,
    detail: approvalDetail,
    jump: 'approval',
  });

  return { items, ready: items.every((i) => i.ok) };
}
