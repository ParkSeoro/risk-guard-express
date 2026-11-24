/**
 * Phase 3: Reviewer 1-Minute Traffic-Light Summary Helper.
 *
 * Pure, unit-testable evaluator that gives approvers an instant overview of:
 *  1) Mandatory attachment completion (법정 필수 첨부)
 *  2) Article 38 Annex 4 body completeness (+ heavy-lifting 5대 위험 check)
 *  3) Rigging plan safety & load utilization (for hasRiggingPlan types)
 *  4) Total uploaded attachments count
 */
import { getWorkPlanType, workPlanLegalClass } from './workPlanTemplates';
import { computeAttachmentProgress } from './workPlanAttachments';
import { validateHeavyLiftLegalRisk, usesFixedLegalRisk } from './workPlanLegalRisk';
import {
  extractLegalCalcSnapshot,
  isRiggingPlanSafe,
  REQUIRED_LEGAL_CALC_IDS,
} from './workPlanLegalCalcGate';

export type TrafficLight = 'ok' | 'warn' | 'fail' | 'na';

export interface ReviewSignal {
  id: 'attachments' | 'annex4' | 'rigging' | 'proofs';
  label: string;
  light: TrafficLight;
  value: string;
  detail?: string;
}

export interface WorkPlanReviewSummary {
  workTypeName: string;
  isArticle38: boolean;
  overall: TrafficLight;
  signals: ReviewSignal[];
}

export interface WorkPlanSectionRowLike {
  key?: string;
  content?: string;
}

function normalizeSectionsToMap(
  sections?: WorkPlanSectionRowLike[] | null,
  content?: Record<string, unknown> | null,
): Record<string, unknown> {
  if (Array.isArray(sections)) {
    const map: Record<string, unknown> = {};
    for (const s of sections) {
      if (s && typeof s.key === 'string') {
        map[s.key] = s.content ?? '';
      }
    }
    return map;
  }
  return content && typeof content === 'object' ? content : {};
}

export function buildWorkPlanReviewSummary(opts: {
  workType: string;
  /** Real DB format: work_plans.sections jsonb array */
  sections?: WorkPlanSectionRowLike[] | null;
  /** Optional map format (backward-compatible for unit tests) */
  content?: Record<string, unknown> | null;
  rigging?: Record<string, unknown> | null;
  attachments?: Array<{
    attachment_key?: string | null;
    name?: string | null;
    description?: string | null;
    is_mandatory?: boolean | null;
    file_url?: string | null;
    category?: string | null;
  }>;
}): WorkPlanReviewSummary {
  const tpl = getWorkPlanType(opts.workType);
  const isArticle38 = workPlanLegalClass(opts.workType) === 'article38';
  const workTypeName = tpl?.name || opts.workType || '작업계획서';

  // 1. Mandatory attachments
  const attProgress = computeAttachmentProgress(opts.attachments ?? []);
  const mandatoryUploaded = attProgress.mandatoryTotal - attProgress.mandatoryMissing;
  const attSignal: ReviewSignal = {
    id: 'attachments',
    label: '필수 첨부',
    light: attProgress.mandatoryMissing > 0 ? 'fail' : 'ok',
    value:
      attProgress.mandatoryTotal > 0
        ? `${mandatoryUploaded}/${attProgress.mandatoryTotal}`
        : '해당 없음',
    detail:
      attProgress.mandatoryMissing > 0
        ? `미첨부 ${attProgress.mandatoryMissing}건: ${attProgress.blockers
            .slice(0, 2)
            .map((b) => b.name)
            .join(', ')}${attProgress.blockers.length > 2 ? ' 외' : ''}`
        : '법정·필수 증빙 모두 첨부됨',
  };

  // 2. Annex 4 body completeness
  const textSections = (tpl?.templateSections ?? []).filter(
    (s) => s.type !== 'rigging' && s.type !== 'table',
  );
  const contentObj = normalizeSectionsToMap(opts.sections, opts.content);
  let filledCount = 0;
  for (const s of textSections) {
    const raw = contentObj[s.key];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      filledCount += 1;
    } else if (raw && typeof raw === 'object' && Object.keys(raw).length > 0) {
      filledCount += 1;
    }
  }
  const heavyLiftErrors = usesFixedLegalRisk(opts.workType)
    ? validateHeavyLiftLegalRisk(typeof contentObj.risk === 'string' ? contentObj.risk : '')
    : [];

  let annexLight: TrafficLight = 'ok';
  let annexDetail = `본문 ${filledCount}/${textSections.length} 항목 작성`;
  if (heavyLiftErrors.length > 0) {
    annexLight = 'fail';
    annexDetail = heavyLiftErrors[0];
  } else if (textSections.length > 0 && filledCount < Math.ceil(textSections.length * 0.6)) {
    annexLight = 'warn';
    annexDetail = `일부 항목 미기재 (${filledCount}/${textSections.length})`;
  }
  const annexSignal: ReviewSignal = {
    id: 'annex4',
    label: isArticle38 ? '별표 4 본문' : '본문 작성',
    light: annexLight,
    value: textSections.length > 0 ? `${filledCount}/${textSections.length}` : '확인',
    detail: annexDetail,
  };

  // 3. Rigging safety OR non-rigging statutory legal calculation
  let riggingSignal: ReviewSignal;
  const requiredCalcs = REQUIRED_LEGAL_CALC_IDS[opts.workType] || [];
  if (tpl?.hasRiggingPlan) {
    const r = opts.rigging as any;
    if (!r) {
      riggingSignal = {
        id: 'rigging',
        label: '리깅 안전율',
        light: 'fail',
        value: '미작성',
        detail: '양중 하중·장비 선정 리깅플랜이 비어 있습니다.',
      };
    } else {
      const safe = isRiggingPlanSafe(r);
      const load = Number(r.load_weight);
      const rated = Number(r.rated_capacity);
      const utilPct =
        Number.isFinite(load) && Number.isFinite(rated) && rated > 0
          ? Math.round((load / rated) * 100)
          : null;
      riggingSignal = {
        id: 'rigging',
        label: '리깅 안전율',
        light: safe ? (utilPct !== null && utilPct > 85 ? 'warn' : 'ok') : 'fail',
        value: safe ? (utilPct !== null ? `적합 (${utilPct}%)` : '적합') : '부적합(N.G)',
        detail: safe
          ? utilPct !== null
            ? `정격하중 대비 ${utilPct}% 사용`
            : '장비·슬링·샤클 판정 적합'
          : '장비/슬링/샤클 안전율 또는 정격하중 초과 확인 필요',
      };
    }
  } else if (requiredCalcs.length > 0 && Array.isArray(opts.sections)) {
    const snap = extractLegalCalcSnapshot(opts.sections);
    const entries = snap?.entries ?? [];
    const missing = requiredCalcs.filter((id) => !entries.some((e) => e.id === id));
    const failed = requiredCalcs.filter((id) => entries.some((e) => e.id === id && e.verdict === 'fail'));
    if (failed.length > 0) {
      riggingSignal = {
        id: 'rigging',
        label: '법정계산',
        light: 'fail',
        value: '부적합',
        detail: '법정계산 판정이 부적합입니다.',
      };
    } else if (missing.length > 0) {
      riggingSignal = {
        id: 'rigging',
        label: '법정계산',
        light: 'fail',
        value: '미실시',
        detail: '해당 공종 필수 법정계산이 미실시 상태입니다.',
      };
    } else {
      riggingSignal = {
        id: 'rigging',
        label: '법정계산',
        light: 'ok',
        value: '적합',
        detail: '공종 필수 법정계산 적합 판정 완료',
      };
    }
  } else {
    riggingSignal = {
      id: 'rigging',
      label: '리깅 안전율',
      light: 'na',
      value: '해당 없음',
    };
  }

  // 4. Total proofs
  const proofSignal: ReviewSignal = {
    id: 'proofs',
    label: '전체 증빙',
    light: attProgress.uploaded > 0 ? 'ok' : 'warn',
    value: `${attProgress.uploaded}/${attProgress.total}건`,
  };

  const signals = [attSignal, annexSignal, riggingSignal, proofSignal];
  const overall: TrafficLight = signals.some((s) => s.light === 'fail')
    ? 'fail'
    : signals.some((s) => s.light === 'warn')
      ? 'warn'
      : 'ok';

  return { workTypeName, isArticle38, overall, signals };
}

export function formatAttachmentRevisionNote(attachmentName: string, reason?: string): string {
  const cleanName = String(attachmentName || '첨부서류').trim();
  const cleanReason = String(reason || '').trim();
  return cleanReason
    ? `[첨부 보완 요청] ${cleanName}: ${cleanReason}`
    : `[첨부 보완 요청] ${cleanName} 서류를 확인 후 보완·재첨부해 주세요.`;
}
