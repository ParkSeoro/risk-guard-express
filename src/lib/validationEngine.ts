import { supabase } from '@/integrations/supabase/client';
import { calculateRiskGrade, type RiskGrade } from './riskGrade';

export interface ValidationIssue {
  riskItemId: string;
  ruleType: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  field?: string;
}

export interface ValidationReport {
  totalItems: number;
  totalIssues: number;
  errors: number;
  warnings: number;
  score: number; // 0-100
  verdict: '적정' | '조건부 적정' | '부적정';
  issues: ValidationIssue[];
}

interface RiskItem {
  id: string;
  process: string;
  sub_task?: string | null;
  hazard?: string | null;
  hazard_situation?: string | null;
  existing_measure?: string | null;
  improvement_measure?: string | null;
  likelihood_grade: string;
  severity_grade: string;
  risk_grade: string;
  improved_likelihood_grade: string;
  improved_severity_grade: string;
  improved_risk_grade: string;
  legal_basis?: string[] | null;
  ppe?: string[] | null;
  status: string;
  department?: string | null;
  assignee?: string | null;
}

const GRADE_ORDER: Record<string, number> = { '상': 3, '중': 2, '하': 1 };

function gradeVal(g: string): number {
  return GRADE_ORDER[g] || 0;
}

export async function validateRiskItems(
  items: RiskItem[],
  projectId: string
): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];

  // Fetch library for underestimation check
  const { data: library } = await supabase
    .from('standard_risk_library')
    .select('sub_task, hazard, default_likelihood_grade, default_severity_grade')
    .eq('is_active', true);

  // Fetch validation rules
  const { data: rules } = await supabase
    .from('validation_rules')
    .select('*')
    .eq('is_active', true);

  const ruleWeights: Record<string, number> = {};
  (rules || []).forEach(r => {
    ruleWeights[r.rule_type] = Number(r.weight) || 1;
  });

  for (const item of items) {
    // 1) Required fields check
    if (!item.hazard || item.hazard.trim() === '') {
      issues.push({ riskItemId: item.id, ruleType: 'missing_field', severity: 'error', message: '위험요인 미기재', field: 'hazard' });
    }
    if (!item.hazard_situation || item.hazard_situation.trim() === '') {
      issues.push({ riskItemId: item.id, ruleType: 'missing_field', severity: 'error', message: '위험발생상황 미기재', field: 'hazard_situation' });
    }
    if (!item.existing_measure || item.existing_measure.trim() === '') {
      issues.push({ riskItemId: item.id, ruleType: 'missing_field', severity: 'warning', message: '기존대책 미기재', field: 'existing_measure' });
    }
    if (!item.improvement_measure || item.improvement_measure.trim() === '') {
      issues.push({ riskItemId: item.id, ruleType: 'missing_field', severity: 'warning', message: '개선대책 미기재', field: 'improvement_measure' });
    }

    // 2) Underestimation check (vs library)
    if (library) {
      const match = library.find(l =>
        l.sub_task === item.sub_task && l.hazard === item.hazard
      );
      if (match) {
        const libLikelihood = gradeVal(match.default_likelihood_grade);
        const libSeverity = gradeVal(match.default_severity_grade);
        const itemLikelihood = gradeVal(item.likelihood_grade);
        const itemSeverity = gradeVal(item.severity_grade);
        if (itemLikelihood < libLikelihood - 0 || itemSeverity < libSeverity - 0) {
          // 1 grade lower = underestimation
          if (libLikelihood - itemLikelihood >= 1 || libSeverity - itemSeverity >= 1) {
            issues.push({
              riskItemId: item.id, ruleType: 'underestimation', severity: 'warning',
              message: `과소평가 의심 (라이브러리 권장: 가능성 ${match.default_likelihood_grade}/중대성 ${match.default_severity_grade})`,
            });
          }
        }
      }
    }

    // 3) High risk but improvement insufficient
    if (item.risk_grade === '상') {
      if (item.improved_risk_grade === '상') {
        issues.push({
          riskItemId: item.id, ruleType: 'insufficient_improvement', severity: 'error',
          message: '위험도 상 항목의 개선후 위험도가 여전히 상 (최소 중 이하로 개선 필요)',
        });
      }
      if (!item.improvement_measure || item.improvement_measure.trim().length < 5) {
        issues.push({
          riskItemId: item.id, ruleType: 'insufficient_improvement', severity: 'error',
          message: '위험도 상 항목에 구체적인 개선대책 필요',
        });
      }
    }

    // 4) Legal basis check for high-risk items
    if (item.risk_grade === '상' || item.risk_grade === '중') {
      if (!item.legal_basis || item.legal_basis.length === 0) {
        issues.push({
          riskItemId: item.id, ruleType: 'missing_legal', severity: 'warning',
          message: '법적근거 미기재 (위험도 중/상 항목)',
        });
      }
    }

    // 5) Completed status but no improved grade
    if (['완료', '승인'].includes(item.status)) {
      if (!item.improved_likelihood_grade || !item.improved_severity_grade) {
        issues.push({
          riskItemId: item.id, ruleType: 'incomplete_completion', severity: 'warning',
          message: '완료/승인 상태이나 개선후 등급 미기재',
        });
      }
    }
  }

  // Calculate score
  const totalItems = items.length;
  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  const weightedPenalty = errors * 10 + warnings * 3;
  const maxScore = totalItems * 10;
  const score = Math.max(0, Math.round(((maxScore - weightedPenalty) / maxScore) * 100));

  // Verdict
  const hasHighRisk = items.some(i => i.risk_grade === '상');
  const hasUnresolvedHigh = items.some(i => i.risk_grade === '상' && i.improved_risk_grade === '상');
  let verdict: '적정' | '조건부 적정' | '부적정';

  if (errors > 0 || score < 60) {
    verdict = '부적정';
  } else if (hasHighRisk || warnings > totalItems * 0.2 || score < 80) {
    verdict = '조건부 적정';
  } else {
    verdict = '적정';
  }

  // Rule: if any high risk item exists, max verdict is 조건부 적정
  if (hasUnresolvedHigh) {
    verdict = '부적정';
  }

  return {
    totalItems,
    totalIssues: issues.length,
    errors,
    warnings,
    score,
    verdict,
    issues,
  };
}

export async function saveValidationResults(
  report: ValidationReport,
  projectId: string,
  userId: string,
  batchId?: string
): Promise<void> {
  const inserts = report.issues.map(issue => ({
    project_id: projectId,
    risk_item_id: issue.riskItemId,
    rule_id: null as string | null,
    status: issue.severity === 'error' ? 'fail' : 'warning',
    message: `[${issue.ruleType}] ${issue.message}`,
    batch_id: batchId || null,
    validated_by: userId,
  }));

  if (inserts.length > 0) {
    // Delete old results for this project first
    await supabase.from('validation_results').delete().eq('project_id', projectId);
    await supabase.from('validation_results').insert(inserts);
  }
}
