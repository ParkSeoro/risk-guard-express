import { inferHazardType } from '@/lib/globalRiskLibrary';
import type { GeneratedRiskItem } from '@/lib/riskAutoGen';
import {
  isAiFailedRiskItem,
  isAiScopeDraftItem,
  isBlankRiskList,
  isBlankRiskText,
} from '@/lib/riskAutoGenAI';
import { calculateRiskGrade, type RiskGrade } from '@/lib/riskGrade';
import { defaultLegalForHazard } from '@/lib/riskLegalDefaults';

export { defaultLegalForHazard } from '@/lib/riskLegalDefaults';

/**
 * [나머지 채우기] is a submit-gap completer, not “ask the LLM to rewrite the row”.
 *
 * - PPE / 법적근거: deterministic (hazard defaults + legal_references).
 * - 발생상황·대책 문장: only then library, then LLM.
 */

const BASE_PPE = ['안전모', '안전화'];

export function defaultPpeForHazard(hazard?: string | null, extra?: string | null): string[] {
  const t = inferHazardType(`${hazard || ''} ${extra || ''}`);
  switch (t) {
    case '추락':
      return [...BASE_PPE, '안전대'];
    case '낙하·비래':
      return [...BASE_PPE, '안전장갑'];
    case '협착·끼임':
      return [...BASE_PPE, '안전장갑'];
    case '감전':
      return [...BASE_PPE, '절연장갑'];
    case '화재·폭발':
      return [...BASE_PPE, '보안경', '용접장갑'];
    case '질식':
      return [...BASE_PPE, '방독마스크'];
    case '화학·중독':
      return [...BASE_PPE, '방진마스크', '안전장갑'];
    case '절단·베임':
      return [...BASE_PPE, '절상방지장갑'];
    default:
      return [...BASE_PPE, '안전장갑'];
  }
}

/** True when the row still needs an LLM for 상황·대책. PPE/legal gaps are local. */
export function needsLlmNarrativeFill(row: {
  note?: string | null;
  hazard?: string | null;
  hazard_situation?: string | null;
  existing_measure?: string | null;
  improvement_measure?: string | null;
}): boolean {
  if (isAiScopeDraftItem(row) || isAiFailedRiskItem(row)) return true;
  return (
    isBlankRiskText(row.hazard_situation) ||
    isBlankRiskText(row.existing_measure) ||
    isBlankRiskText(row.improvement_measure)
  );
}

function pickText(current?: string | null, overlay?: string | null): string {
  if (!isBlankRiskText(current)) return String(current).trim();
  return String(overlay || '').trim();
}

function pickList(current?: unknown, overlay?: unknown): string[] {
  if (!isBlankRiskList(current)) {
    return (current as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean);
  }
  if (!isBlankRiskList(overlay)) {
    return (overlay as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean);
  }
  return [];
}

function asGrade(v: unknown, fallback: RiskGrade = '중'): RiskGrade {
  const s = String(v || '').trim();
  return s === '상' || s === '중' || s === '하' ? s : fallback;
}

/** Merge library overlay onto the live row, then default PPE if still empty. */
export function seedFillDetailFromRow(
  row: {
    process?: string | null;
    sub_task?: string | null;
    hazard?: string | null;
    hazard_situation?: string | null;
    existing_measure?: string | null;
    improvement_measure?: string | null;
    ppe?: string[] | null;
    legal_basis?: string[] | null;
    likelihood_grade?: string | null;
    severity_grade?: string | null;
    risk_grade?: string | null;
    improved_likelihood_grade?: string | null;
    improved_severity_grade?: string | null;
    improved_risk_grade?: string | null;
    frequency?: number | null;
    severity?: number | null;
    improved_frequency?: number | null;
    improved_severity?: number | null;
  },
  overlay?: Partial<GeneratedRiskItem> | null,
): GeneratedRiskItem {
  const hazard = pickText(row.hazard, overlay?.hazard);
  const situation = pickText(row.hazard_situation, overlay?.hazard_situation);
  const existing = pickText(row.existing_measure, overlay?.existing_measure);
  const improve = pickText(row.improvement_measure, overlay?.improvement_measure);
  let ppe = pickList(row.ppe, overlay?.ppe);
  if (ppe.length === 0) ppe = defaultPpeForHazard(hazard, situation);
  let legal = pickList(row.legal_basis, overlay?.legal_basis);
  if (legal.length === 0) legal = defaultLegalForHazard(hazard, situation);
  const lg = asGrade(row.likelihood_grade || overlay?.likelihood_grade);
  const sg = asGrade(row.severity_grade || overlay?.severity_grade);
  const ilg = asGrade(row.improved_likelihood_grade || overlay?.improved_likelihood_grade, lg === '상' ? '중' : '하');
  const isg = asGrade(row.improved_severity_grade || overlay?.improved_severity_grade, sg);
  return {
    process: String(row.process || overlay?.process || '').trim(),
    sub_task: String(row.sub_task || overlay?.sub_task || hazard).trim(),
    hazard,
    hazard_situation: situation,
    existing_measure: existing,
    improvement_measure: improve,
    likelihood_grade: lg,
    severity_grade: sg,
    risk_grade: asGrade(row.risk_grade || overlay?.risk_grade, calculateRiskGrade(lg, sg)),
    improved_likelihood_grade: ilg,
    improved_severity_grade: isg,
    improved_risk_grade: asGrade(
      row.improved_risk_grade || overlay?.improved_risk_grade,
      calculateRiskGrade(ilg, isg),
    ),
    frequency: Number(row.frequency ?? overlay?.frequency ?? (lg === '상' ? 4 : lg === '중' ? 3 : 2)),
    severity: Number(row.severity ?? overlay?.severity ?? (sg === '상' ? 4 : sg === '중' ? 3 : 2)),
    improved_frequency: Number(
      row.improved_frequency ?? overlay?.improved_frequency ?? (ilg === '상' ? 3 : ilg === '중' ? 2 : 1),
    ),
    improved_severity: Number(row.improved_severity ?? overlay?.improved_severity ?? (isg === '상' ? 4 : isg === '중' ? 3 : 2)),
    ppe,
    legal_basis: legal,
    department: '',
    assignee: '',
    status: '초안',
    tags: [],
  };
}
