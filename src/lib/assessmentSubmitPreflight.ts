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
  /** Rows missing 개선대책 / PPE / (중·상) 법적근거 / 상황·기존대책 */
  incompleteItemCount?: number;
  incompleteItemDetail?: string;
}): { items: AssessmentPreflightItem[]; ready: boolean } {
  const items: AssessmentPreflightItem[] = [];

  const authorOk = !!opts.authorUserId;
  const submitterOk = !!opts.authorUserId && !!opts.currentUserId && opts.authorUserId === opts.currentUserId;
  items.push({
    id: 'author',
    label: '작성 주체(관리감독자) 지정',
    ok: authorOk,
    detail: authorOk ? (opts.authorName || '지정됨') : '관리감독자를 지정하세요',
  });
  items.push({
    id: 'author_submitter',
    label: '상신자는 작성 관리감독자',
    ok: submitterOk,
    detail: submitterOk
      ? '본인'
      : authorOk
        ? `작성 관리감독자(${opts.authorName || '지정됨'})만 상신 가능`
        : '작성 주체 지정 후 해당 관리감독자가 상신',
  });

  items.push({
    id: 'items',
    label: '위험성평가 항목 1건 이상',
    ok: opts.itemCount > 0,
    detail: opts.itemCount > 0 ? `${opts.itemCount}건` : '항목을 추가하세요',
    jump: 'items',
  });

  const incomplete = opts.incompleteItemCount || 0;
  items.push({
    id: 'item_fields',
    label: '개선대책·PPE·법적근거 기재',
    ok: incomplete === 0,
    detail: incomplete === 0
      ? '완료'
      : (opts.incompleteItemDetail || `${incomplete}행 미기재 · [나머지 채우기] 또는 직접 입력`),
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

function blankText(v?: string | null) {
  return !String(v || '').trim();
}

function blankList(v?: unknown) {
  if (!Array.isArray(v)) return true;
  return v.map((x) => String(x ?? '').trim()).filter(Boolean).length === 0;
}

export type AssessmentItemGapRow = {
  is_excluded?: boolean | null;
  is_deleted?: boolean | null;
  hazard_situation?: string | null;
  existing_measure?: string | null;
  improvement_measure?: string | null;
  ppe?: string[] | null;
  legal_basis?: string[] | null;
  risk_grade?: string | null;
};

/** 상신 차단용 — 하 등급은 법적근거 없어도 통과. */
export function countIncompleteAssessmentItems(items: AssessmentItemGapRow[]): {
  count: number;
  detail: string;
} {
  const active = (items || []).filter((i) => !i.is_excluded && !i.is_deleted);
  let improvement = 0;
  let ppe = 0;
  let legal = 0;
  let situation = 0;
  let existing = 0;
  let count = 0;
  for (const it of active) {
    const missSit = blankText(it.hazard_situation);
    const missEx = blankText(it.existing_measure);
    const missIm = blankText(it.improvement_measure);
    const missPpe = blankList(it.ppe);
    const grade = String(it.risk_grade || '');
    const missLegal = (grade === '상' || grade === '중') && blankList(it.legal_basis);
    if (missSit) situation += 1;
    if (missEx) existing += 1;
    if (missIm) improvement += 1;
    if (missPpe) ppe += 1;
    if (missLegal) legal += 1;
    if (missSit || missEx || missIm || missPpe || missLegal) count += 1;
  }
  if (count === 0) return { count: 0, detail: '완료' };
  const parts = [
    improvement ? `개선대책 ${improvement}` : '',
    ppe ? `PPE ${ppe}` : '',
    legal ? `법적근거 ${legal}` : '',
    situation ? `발생상황 ${situation}` : '',
    existing ? `기존대책 ${existing}` : '',
  ].filter(Boolean);
  return {
    count,
    detail: `${count}행 미기재 (${parts.join(', ')}) · [나머지 채우기] 또는 직접 입력`,
  };
}
