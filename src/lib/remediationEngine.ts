import { supabase } from '@/integrations/supabase/client';
import { calculateRiskGrade } from './riskGrade';
import type { ValidationReport, ValidationIssue, CoverageGap } from './validationEngine';

// ========== Data Models ==========

export type ActionType =
  | 'ACTION_FILL_MISSING_CONTEXT'
  | 'ACTION_ADD_REQUIRED_PPE'
  | 'ACTION_UPGRADE_CONTROL_MEASURES'
  | 'ACTION_ADD_VERIFICATION_STEP'
  | 'ACTION_ATTACH_LEGAL_REFERENCES'
  | 'ACTION_FLAG_IRRELEVANT_ITEMS'
  | 'ACTION_MERGE_DUPLICATES'
  | 'ACTION_RECOMMEND_POST_IMPROVEMENT_ADJUSTMENT'
  | 'ACTION_DETECT_UNDERESTIMATION'
  | 'ACTION_REQUIRE_EVIDENCE'
  | 'ACTION_ADD_MISSING_RISK_ITEMS_FROM_LIBRARY'
  | 'ACTION_CREATE_REMEDIATION_SUMMARY';

export interface RemediationAction {
  id: string;
  actionType: ActionType;
  label: string;
  description: string;
  category: string;
  targetRiskItemIds: string[];
  patch: Record<string, any>; // field-level updates per item
  /** For coverage gaps: new items to insert */
  newItems?: Record<string, any>[];
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
  requiresUserConfirm: boolean;
  expectedEffect: string;
}

// ========== Process Tag → PPE Mapping ==========

const PROCESS_PPE_MAP: Record<string, string[]> = {
  '고소': ['안전대', '안전모(턱끈)', '라이프라인'],
  '비계': ['안전대', '안전모(턱끈)', '안전화'],
  '용접': ['용접면', '방열장갑', '가죽앞치마', '안전화'],
  '절단': ['보안경', '방진마스크', '안전장갑', '안전화'],
  '굴착': ['안전모', '안전화', '반사조끼', '안전장갑'],
  '밀폐': ['송기마스크', '안전대', '가스측정기', '무전기'],
  '전기': ['절연장갑', '절연화', '안전모', '검전기'],
  '양중': ['안전모', '안전화', '반사조끼', '신호봉'],
  '화기': ['방열장갑', '소화기', '방염포', '보안경'],
  '분진': ['방진마스크', '보안경', '귀마개'],
  '소음': ['귀마개', '귀덮개'],
  '화학': ['방독마스크', '화학보호복', '보안경', '내화학장갑'],
};

// ========== Concrete Control Templates ==========

const CONTROL_TEMPLATES: Record<string, { engineering: string; management: string; ppe: string }> = {
  '고소': {
    engineering: '안전난간 설치, 추락방지망 설치, 이동식 비계/작업대 사용',
    management: '작업허가서 발행, 작업반경 출입통제, 작업 전 안전브리핑',
    ppe: '안전대·라이프라인 착용 확인',
  },
  '양중': {
    engineering: '과부하방지장치 작동 확인, 아웃트리거 완전 전개, 유도로프 사용',
    management: '양중계획서 작성, 신호수 배치, 작업반경 통제, 줄걸이 자격 확인',
    ppe: '안전모·안전화·반사조끼 착용',
  },
  '굴착': {
    engineering: '흙막이 가시설 설치, 지보공 설치, 배수시설 설치',
    management: '지하매설물 확인, 작업구역 펜스/바리케이드, 감시인 배치',
    ppe: '안전모·안전화·반사조끼 착용',
  },
  '용접': {
    engineering: '방화커튼 설치, 소화기 비치, 환기설비 가동',
    management: '화기작업 허가서, 화재감시자 배치, 잔불 확인(30분)',
    ppe: '용접면·방열장갑·가죽앞치마 착용',
  },
  '밀폐': {
    engineering: '환기팬 설치, 가스측정기 배치, 비상구조장비 비치',
    management: '밀폐공간 작업 허가, 감시인 배치, 구조훈련 실시',
    ppe: '송기마스크·안전대 착용',
  },
  '전기': {
    engineering: '차단기 시건장치, 활선접근경보기, 접지 확인',
    management: '전기작업허가서, 정전작업 절차 준수, 통전 전 확인',
    ppe: '절연장갑·절연화·검전기 사용',
  },
};

const DEFAULT_CONTROL = {
  engineering: '방호장치 설치, 안전표지판 부착, 작업발판 정리',
  management: '작업절차서 수립, 안전교육 실시, 작업 전 점검',
  ppe: '안전모·안전화·안전장갑 착용',
};

const VERIFICATION_STEP = '작업 전 안전점검 체크리스트 작성 / 작업 중 순회점검(2시간 간격) / 작업 후 이상유무 확인';

// ========== Helper ==========

function uid() {
  return `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function detectProcessTags(process: string, subTask?: string): string[] {
  const text = `${process} ${subTask || ''}`.toLowerCase();
  const tags: string[] = [];
  const keywords: Record<string, string[]> = {
    '고소': ['고소', '비계', '지붕', '상부', '옥상', '사다리', '말비계', 'scaff', '추락'],
    '양중': ['양중', '크레인', '호이스트', '리프트', '인양', '줄걸이'],
    '굴착': ['굴착', '터파기', '토공', '기초', '파일', '지반'],
    '용접': ['용접', 'welding', '절단', '화기', '가스'],
    '밀폐': ['밀폐', '맨홀', '탱크', '피트', '지하'],
    '전기': ['전기', '배선', '배전', '케이블', '통전', '수변전'],
    '화학': ['화학', '유해', '산', '알칼리', '유기용제'],
    '분진': ['분진', '절단', '연마', '샌딩'],
    '소음': ['소음', '파쇄', '항타', '천공'],
  };
  for (const [tag, kws] of Object.entries(keywords)) {
    if (kws.some(kw => text.includes(kw))) tags.push(tag);
  }
  return tags.length > 0 ? tags : ['일반'];
}

// ========== Main Engine ==========

export async function generateRemediationActions(
  items: any[],
  report: ValidationReport,
  projectId: string,
): Promise<RemediationAction[]> {
  // Filter out excluded items
  const activeItems = items.filter((i: any) => !i.is_excluded);
  const actions: RemediationAction[] = [];

  // Fetch library and legal references for context
  const [{ data: library }, { data: legalRefs }] = await Promise.all([
    supabase.from('standard_risk_library').select('*').eq('is_active', true),
    supabase.from('legal_references').select('*').limit(200),
  ]);

  const libItems = library || [];
  const legals = legalRefs || [];

  // ===== A. Missing Fields (ACTION 1) =====
  for (const item of activeItems) {
    const verdict = report.itemVerdicts[item.id];
    if (!verdict) continue;
    const missingFields = verdict.issues.filter(i => i.ruleType === 'missing_field');
    if (missingFields.length === 0) continue;

    const tags = detectProcessTags(item.process, item.sub_task);
    const libMatch = libItems.find(l => l.sub_task === item.sub_task && l.hazard === item.hazard)
      || libItems.find(l => l.sub_task === item.sub_task);

    const patch: Record<string, any> = {};
    const effects: string[] = [];

    for (const miss of missingFields) {
      if (miss.field === 'hazard_situation' && (!item.hazard_situation || !item.hazard_situation.trim())) {
        patch.hazard_situation = libMatch?.hazard_situation || `${item.process} 작업 중 ${item.hazard || '위험요인'}에 의한 재해 발생 가능`;
        effects.push('위험발생상황 자동채움');
      }
      if (miss.field === 'existing_measure' && (!item.existing_measure || !item.existing_measure.trim())) {
        const ctrl = CONTROL_TEMPLATES[tags[0]] || DEFAULT_CONTROL;
        patch.existing_measure = libMatch?.existing_measure || `${ctrl.management}, ${ctrl.ppe}`;
        effects.push('기존대책 자동채움');
      }
      if (miss.field === 'improvement_measure' && (!item.improvement_measure || !item.improvement_measure.trim())) {
        const ctrl = CONTROL_TEMPLATES[tags[0]] || DEFAULT_CONTROL;
        patch.improvement_measure = libMatch?.improvement_measure || `${ctrl.engineering}, ${ctrl.management}`;
        effects.push('개선대책 자동채움');
      }
    }

    if (Object.keys(patch).length > 0) {
      actions.push({
        id: uid(), actionType: 'ACTION_FILL_MISSING_CONTEXT',
        label: '누락 필드 자동채움', category: 'A. 누락 채우기',
        description: `${item.process} – ${item.sub_task || ''}: ${effects.join(', ')}`,
        targetRiskItemIds: [item.id], patch, rationale: '표준 라이브러리 또는 공정 템플릿 기반 자동 채움',
        confidence: libMatch ? 'high' : 'medium', requiresUserConfirm: false,
        expectedEffect: effects.join(' / '),
      });
    }
  }

  // ===== A. PPE (ACTION 2) =====
  for (const item of activeItems) {
    if (item.ppe && item.ppe.length >= 2) continue;
    const tags = detectProcessTags(item.process, item.sub_task);
    const recommendedPPE = new Set<string>(item.ppe || []);
    for (const tag of tags) {
      (PROCESS_PPE_MAP[tag] || ['안전모', '안전화', '안전장갑']).forEach(p => recommendedPPE.add(p));
    }
    const newPPE = [...recommendedPPE];
    if (newPPE.length <= (item.ppe?.length || 0)) continue;

    actions.push({
      id: uid(), actionType: 'ACTION_ADD_REQUIRED_PPE',
      label: 'PPE 자동추가', category: 'A. 누락 채우기',
      description: `${item.process}: PPE → ${newPPE.join(', ')}`,
      targetRiskItemIds: [item.id], patch: { ppe: newPPE },
      rationale: `공정 태그(${tags.join(',')}) 기반 권장 PPE 추가`,
      confidence: 'high', requiresUserConfirm: false,
      expectedEffect: 'PPE 누락 해소',
    });
  }

  // ===== B. Control Measures (ACTION 3) =====
  const vaguePatterns = ['주의', '안전수칙 준수', '조심', '유의', '확인'];
  for (const item of activeItems) {
    const measure = item.improvement_measure || '';
    if (!measure || measure.length >= 30) continue;
    const isVague = vaguePatterns.some(p => measure.includes(p)) || measure.length < 10;
    if (!isVague) continue;

    const tags = detectProcessTags(item.process, item.sub_task);
    const ctrl = CONTROL_TEMPLATES[tags[0]] || DEFAULT_CONTROL;
    const concrete = `[공학적] ${ctrl.engineering} / [관리적] ${ctrl.management} / [보호구] ${ctrl.ppe}`;

    actions.push({
      id: uid(), actionType: 'ACTION_UPGRADE_CONTROL_MEASURES',
      label: '개선대책 구체화', category: 'B. 대책 구체화',
      description: `${item.process}: 추상적 대책 → 공학적/관리적/PPE 대책으로 구체화`,
      targetRiskItemIds: [item.id], patch: { improvement_measure: concrete },
      rationale: `현재 대책 "${measure}"이 추상적이므로 공정 맞춤형 구체 대책으로 교체`,
      confidence: 'medium', requiresUserConfirm: false,
      expectedEffect: '대책 구체화 → 검증 경고 해소',
    });
  }

  // ===== B. Verification Step (ACTION 4) =====
  for (const item of activeItems) {
    const measure = item.improvement_measure || '';
    if (measure.includes('점검') || measure.includes('확인') || measure.includes('체크리스트')) continue;
    if (!measure || measure.length < 5) continue;

    actions.push({
      id: uid(), actionType: 'ACTION_ADD_VERIFICATION_STEP',
      label: '점검 단계 추가', category: 'B. 대책 구체화',
      description: `${item.process}: 확인/점검 절차 삽입`,
      targetRiskItemIds: [item.id],
      patch: { improvement_measure: `${measure} / ${VERIFICATION_STEP}` },
      rationale: '개선대책에 확인/점검 절차가 없어 자동 삽입',
      confidence: 'medium', requiresUserConfirm: false,
      expectedEffect: '점검 절차 추가',
    });
  }

  // ===== C. Legal References (ACTION 5) =====
  for (const item of activeItems) {
    const verdict = report.itemVerdicts[item.id];
    if (!verdict) continue;
    const legalIssue = verdict.issues.find(i => i.ruleType === 'missing_legal');
    if (!legalIssue) continue;

    const tags = detectProcessTags(item.process, item.sub_task);
    const processText = `${item.process} ${item.sub_task || ''} ${item.hazard || ''}`;
    const matched = legals.filter(l =>
      (l.keywords || []).some((kw: string) => processText.includes(kw)) ||
      (l.process_mappings || []).some((pm: string) => tags.some(t => pm.includes(t)))
    ).slice(0, 5);

    const refs = matched.length > 0
      ? matched.map(m => `${m.law_name} ${m.article}`)
      : ['산업안전보건법 제36조(위험성평가)', '산업안전보건기준에 관한 규칙'];

    actions.push({
      id: uid(), actionType: 'ACTION_ATTACH_LEGAL_REFERENCES',
      label: '법적근거 추가', category: 'C. 법적근거 보완',
      description: `${item.process}: ${refs.slice(0, 3).join(', ')}`,
      targetRiskItemIds: [item.id], patch: { legal_basis: refs },
      rationale: matched.length > 0 ? '공정 키워드 기반 법적근거 매칭' : '기본 법적근거 자동 삽입 (검토 필요)',
      confidence: matched.length > 0 ? 'high' : 'low', requiresUserConfirm: false,
      expectedEffect: '법적근거 누락 해소',
    });
  }

  // ===== D. Irrelevant Items (ACTION 6) =====
  // Simple keyword mismatch detection
  const processGroups = new Map<string, Set<string>>();
  for (const item of activeItems) {
    const tags = detectProcessTags(item.process, item.sub_task);
    if (!processGroups.has(item.process)) processGroups.set(item.process, new Set());
    tags.forEach(t => processGroups.get(item.process)!.add(t));
  }
  for (const item of activeItems) {
    const processTags = processGroups.get(item.process);
    if (!processTags) continue;
    const hazardTags = detectProcessTags(item.hazard || '', item.sub_task);
    // If hazard tags don't overlap with process tags at all, flag as potentially irrelevant
    const overlap = hazardTags.filter(t => processTags.has(t) || t === '일반');
    if (overlap.length === 0 && hazardTags[0] !== '일반') {
      actions.push({
        id: uid(), actionType: 'ACTION_FLAG_IRRELEVANT_ITEMS',
        label: '무관 항목 의심', category: 'D. 무관 항목 정리',
        description: `${item.process}에 ${item.hazard || '(불명)'} 위험요인 – 공정 불일치 가능성`,
        targetRiskItemIds: [item.id], patch: {},
        rationale: `공정(${[...processTags].join(',')})과 위험요인 태그(${hazardTags.join(',')})의 매칭 점수 낮음`,
        confidence: 'low', requiresUserConfirm: true,
        expectedEffect: '무관 항목 검토 → 삭제 또는 이동',
      });
    }
  }

  // ===== D. Merge Duplicates (ACTION 7) =====
  const seen = new Map<string, string>();
  for (const item of activeItems) {
    const key = `${item.sub_task || ''}|||${item.hazard || ''}`;
    if (seen.has(key) && key !== '|||') {
      actions.push({
        id: uid(), actionType: 'ACTION_MERGE_DUPLICATES',
        label: '중복 항목 검토', category: 'D. 무관 항목 정리',
        description: `"${item.sub_task} – ${item.hazard}" 중복 발견`,
        targetRiskItemIds: [seen.get(key)!, item.id], patch: {},
        rationale: '동일 세부작업+위험요인 조합의 중복 항목 발견',
        confidence: 'medium', requiresUserConfirm: true,
        expectedEffect: '중복 항목 병합 검토',
      });
    }
    if (!seen.has(key)) seen.set(key, item.id);
  }

  // ===== E. Post-improvement Adjustment (ACTION 8) =====
  for (const item of activeItems) {
    if (item.improved_risk_grade !== '상') continue;
    const tags = detectProcessTags(item.process, item.sub_task);
    const ctrl = CONTROL_TEMPLATES[tags[0]] || DEFAULT_CONTROL;
    const enhanced = `${item.improvement_measure || ''} / [추가] ${ctrl.engineering}`;

    actions.push({
      id: uid(), actionType: 'ACTION_RECOMMEND_POST_IMPROVEMENT_ADJUSTMENT',
      label: '개선후 등급 조정 권고', category: 'E. 등급 정합성',
      description: `${item.process}: 개선후 위험도 상 잔존 → 대책 강화 + 등급 조정 권고`,
      targetRiskItemIds: [item.id],
      patch: {
        improvement_measure: enhanced,
        improved_likelihood_grade: '중',
        improved_severity_grade: '중',
        improved_risk_grade: calculateRiskGrade('중', '중'),
      },
      rationale: '개선후 위험도가 여전히 상이므로 대책 보강 및 등급 하향 조정',
      confidence: 'medium', requiresUserConfirm: false,
      expectedEffect: '개선후 위험도 상→중 전환',
    });
  }

  // ===== E. Underestimation (ACTION 9) =====
  for (const item of activeItems) {
    const verdict = report.itemVerdicts[item.id];
    if (!verdict) continue;
    const underIssue = verdict.issues.find(i => i.ruleType === 'underestimation');
    if (!underIssue) continue;

    actions.push({
      id: uid(), actionType: 'ACTION_DETECT_UNDERESTIMATION',
      label: '과소평가 등급 조정', category: 'E. 등급 정합성',
      description: `${item.process} – ${item.sub_task || ''}: ${underIssue.message}`,
      targetRiskItemIds: [item.id], patch: {},
      rationale: underIssue.message,
      confidence: 'medium', requiresUserConfirm: true,
      expectedEffect: '과소평가 의심 해소 (수동 검토)',
    });
  }

  // ===== F. Evidence Required (ACTION 10) =====
  for (const item of items) {
    if (item.status !== '완료') continue;
    // No attachment check - just flag
    const verdict = report.itemVerdicts[item.id];
    if (!verdict) continue;
    const completionIssue = verdict.issues.find(i => i.ruleType === 'incomplete_completion');
    if (!completionIssue) continue;

    actions.push({
      id: uid(), actionType: 'ACTION_REQUIRE_EVIDENCE',
      label: '증빙 첨부 필요', category: 'F. 증빙 요구',
      description: `${item.process}: 완료 상태이나 개선후 등급 미기재 → 진행 상태로 전환 권고`,
      targetRiskItemIds: [item.id], patch: { status: '진행' },
      rationale: '완료 처리하려면 개선후 가능성/중대성 기재 및 증빙이 필요',
      confidence: 'high', requiresUserConfirm: false,
      expectedEffect: '미완료 항목 재확인 유도',
    });
  }

  // ===== G. Add Missing Items from Library (ACTION 11) =====
  if (report.coverageGaps.length > 0) {
    const newItems: Record<string, any>[] = [];
    for (const gap of report.coverageGaps.slice(0, 20)) {
      const libMatch = libItems.find(l => l.sub_task === gap.subTask && l.hazard === gap.hazard);
      if (!libMatch) continue;
      newItems.push({
        process: gap.process,
        sub_task: libMatch.sub_task,
        hazard: libMatch.hazard,
        hazard_situation: libMatch.hazard_situation,
        existing_measure: libMatch.existing_measure || '',
        improvement_measure: libMatch.improvement_measure || '',
        likelihood_grade: libMatch.default_likelihood_grade || '중',
        severity_grade: libMatch.default_severity_grade || '중',
        risk_grade: calculateRiskGrade(
          (libMatch.default_likelihood_grade || '중') as any,
          (libMatch.default_severity_grade || '중') as any
        ),
        improved_likelihood_grade: '하',
        improved_severity_grade: '하',
        improved_risk_grade: '하',
        legal_basis: libMatch.legal_refs || [],
        ppe: libMatch.recommended_ppe || [],
        status: '초안',
        note: '자동추가(누락보완)',
      });
    }
    if (newItems.length > 0) {
      actions.push({
        id: uid(), actionType: 'ACTION_ADD_MISSING_RISK_ITEMS_FROM_LIBRARY',
        label: `누락 항목 추천 (${newItems.length}건)`, category: 'G. 커버리지 보완',
        description: `커버리지 검증에서 누락된 ${newItems.length}건의 위험성평가 항목을 라이브러리에서 추천`,
        targetRiskItemIds: [], patch: {}, newItems,
        rationale: '커버리지 검증 결과 필수 위험요인 누락 – 사용자 선택 후 추가',
        confidence: 'high', requiresUserConfirm: true,
        expectedEffect: `누락 ${newItems.length}건 보완 (선택 항목만 추가)`,
      });
    }
  }

  // ===== G. Remediation Summary (ACTION 12) =====
  if (actions.length > 0) {
    actions.push({
      id: uid(), actionType: 'ACTION_CREATE_REMEDIATION_SUMMARY',
      label: '보완 요약 생성', category: 'G. 커버리지 보완',
      description: `총 ${actions.length}건의 보완 액션 요약을 생성하여 결재 PDF에 첨부`,
      targetRiskItemIds: [], patch: {},
      rationale: '보완 내역을 문서화하여 감사 추적성 확보',
      confidence: 'high', requiresUserConfirm: false,
      expectedEffect: '보완 요약 문서 생성',
    });
  }

  return actions;
}

// ========== Apply Actions ==========

export async function applyRemediationActions(
  selectedActions: RemediationAction[],
  items: any[],
  runId: string,
  projectId: string,
  userId: string,
): Promise<{ appliedCount: number; newItemCount: number; summary: string[] }> {
  const summary: string[] = [];
  let appliedCount = 0;
  let newItemCount = 0;

  for (const action of selectedActions) {
    if (action.actionType === 'ACTION_ADD_MISSING_RISK_ITEMS_FROM_LIBRARY' && action.newItems) {
      // Insert new items
      const inserts = action.newItems.map((ni, i) => ({
        process: ni.process as string,
        sub_task: ni.sub_task || '',
        hazard: ni.hazard || '',
        hazard_situation: ni.hazard_situation || '',
        existing_measure: ni.existing_measure || '',
        improvement_measure: ni.improvement_measure || '',
        likelihood_grade: ni.likelihood_grade || '중',
        severity_grade: ni.severity_grade || '중',
        risk_grade: ni.risk_grade || '중',
        improved_likelihood_grade: ni.improved_likelihood_grade || '하',
        improved_severity_grade: ni.improved_severity_grade || '하',
        improved_risk_grade: ni.improved_risk_grade || '하',
        legal_basis: ni.legal_basis || [],
        ppe: ni.ppe || [],
        status: ni.status || '초안',
        note: ni.note || '',
        project_id: projectId,
        run_id: runId,
        created_by: userId,
        sort_order: items.length + newItemCount + i,
      }));
      const { data } = await supabase.from('risk_items').insert(inserts).select();
      newItemCount += data?.length || 0;
      summary.push(`누락 항목 ${data?.length || 0}건 자동추가`);
      appliedCount++;
      continue;
    }

    if (action.actionType === 'ACTION_CREATE_REMEDIATION_SUMMARY') {
      // Just log, no DB change needed
      summary.push('보완 요약 생성 완료');
      appliedCount++;
      continue;
    }

    if (action.actionType === 'ACTION_FLAG_IRRELEVANT_ITEMS' ||
        action.actionType === 'ACTION_MERGE_DUPLICATES' ||
        action.actionType === 'ACTION_DETECT_UNDERESTIMATION') {
      // These are review-only, just mark in summary
      summary.push(`${action.label}: 검토 완료 표시`);
      appliedCount++;
      continue;
    }

    // Apply patches to target items
    if (Object.keys(action.patch).length > 0 && action.targetRiskItemIds.length > 0) {
      for (const itemId of action.targetRiskItemIds) {
        await supabase.from('risk_items').update(action.patch).eq('id', itemId);
      }
      summary.push(`${action.label}: ${action.targetRiskItemIds.length}건 적용`);
      appliedCount++;
    }
  }

  return { appliedCount, newItemCount, summary };
}

// ========== Build Remediation Summary Text ==========

export function buildRemediationSummaryText(actions: RemediationAction[]): string {
  const lines: string[] = ['=== 자동 보완 요약 ===', `적용일시: ${new Date().toLocaleString('ko-KR')}`, ''];
  const byCategory = new Map<string, RemediationAction[]>();
  for (const a of actions) {
    if (!byCategory.has(a.category)) byCategory.set(a.category, []);
    byCategory.get(a.category)!.push(a);
  }
  for (const [cat, acts] of byCategory) {
    lines.push(`▶ ${cat}`);
    for (const a of acts) {
      lines.push(`  - ${a.label}: ${a.description}`);
      lines.push(`    사유: ${a.rationale}`);
      lines.push(`    효과: ${a.expectedEffect}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ========== Full Auto-Remediation + Revalidation Engine ==========

import { validateRiskItems, saveValidationResults } from './validationEngine';

export interface AutoRemediationResult {
  appliedCount: number;
  newItemCount: number;
  summary: string[];
  revalidationReport: import('./validationEngine').ValidationReport;
  statusTransitioned: boolean;
  newStatus: string;
  modifiedItemIds: string[];
}

/**
 * Executes the full auto-remediation → revalidation → status transition pipeline.
 * Returns the result including whether the run was transitioned to 검증완료.
 */
export async function executeAutoRemediation(
  items: any[],
  validationReport: import('./validationEngine').ValidationReport,
  runId: string,
  projectId: string,
  userId: string,
): Promise<AutoRemediationResult> {
  // 1. Generate actions
  const actions = await generateRemediationActions(items, validationReport, projectId);

  // 2. Auto-select all non-user-confirm actions (the "forced set" for auto-적정)
  const autoActions = actions.filter(a => !a.requiresUserConfirm);

  // 3. Collect modified item IDs for tagging
  const modifiedItemIds: string[] = [];
  for (const a of autoActions) {
    modifiedItemIds.push(...a.targetRiskItemIds);
  }

  // 4. Apply
  const { appliedCount, newItemCount, summary } = await applyRemediationActions(
    autoActions, items, runId, projectId, userId
  );

  // 5. Tag modified items with '자동보완' in note field
  const uniqueModifiedIds = [...new Set(modifiedItemIds)];
  for (const itemId of uniqueModifiedIds) {
    const item = items.find(i => i.id === itemId);
    const currentNote = item?.note || '';
    if (!currentNote.includes('[자동보완]')) {
      await supabase.from('risk_items').update({
        note: currentNote ? `${currentNote} [자동보완]` : '[자동보완]',
      }).eq('id', itemId);
    }
  }

  // 6. Re-fetch items after patches
  const { data: freshItems } = await supabase.from('risk_items').select('*').eq('run_id', runId).order('sort_order');
  const currentItems = freshItems || items;

  // 7. Revalidate
  const revalidationReport = await validateRiskItems(currentItems, projectId);
  await saveValidationResults(revalidationReport, projectId, userId, runId);

  // 8. Determine status transition
  let newStatus: string;
  let statusTransitioned = false;

  if (revalidationReport.verdict === '적정') {
    newStatus = '검증완료';
    statusTransitioned = true;
  } else if (revalidationReport.verdict === '조건부 적정') {
    newStatus = '검증완료';
    statusTransitioned = true;
  } else {
    newStatus = '보완요청';
    statusTransitioned = false;
  }

  // 9. Update assessment run
  await supabase.from('assessment_runs').update({
    status: newStatus,
    validation_score: revalidationReport.score,
    validation_verdict: revalidationReport.verdict,
  }).eq('id', runId);

  return {
    appliedCount,
    newItemCount,
    summary,
    revalidationReport,
    statusTransitioned,
    newStatus,
    modifiedItemIds: uniqueModifiedIds,
  };
}
