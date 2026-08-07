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
}): { items: AssessmentPreflightItem[]; ready: boolean } {
  const items: AssessmentPreflightItem[] = [];

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
  const linesOk =
    opts.approvalLineCount >= 2
    && missing.length === 0
    && ssotInvalid.length === 0;

  let approvalDetail = `${opts.approvalLineCount}단계`;
  if (opts.approvalLineCount < 2) {
    approvalDetail = '결재선 [자동 생성] 후 [저장] 필요';
  } else if (ssotInvalid.length > 0) {
    approvalDetail = `구형 단계 키: ${Array.from(new Set(ssotInvalid)).join(', ')}`;
  } else if (missing.length > 0) {
    approvalDetail = `결재자 미지정: ${missing.join(', ')}`;
  }

  items.push({
    id: 'approval',
    label: '결재선 설정·결재자 지정',
    ok: linesOk,
    detail: approvalDetail,
    jump: 'approval',
  });

  return { items, ready: items.every((i) => i.ok) };
}
