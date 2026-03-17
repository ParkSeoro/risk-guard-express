import { supabase } from '@/integrations/supabase/client';
import { calculateRiskGrade, type RiskGrade } from './riskGrade';

export interface ValidationIssue {
  riskItemId: string;
  ruleType: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  field?: string;
  recommendation?: string;
}

export interface CoverageGap {
  process: string;
  subTask: string;
  hazard: string;
  severity: '상' | '중' | '하';
  message: string;
}

export interface ValidationReport {
  totalItems: number;
  totalIssues: number;
  errors: number;
  warnings: number;
  score: number;
  verdict: '적정' | '적정(관리대상)' | '조건부 적정' | '부적정';
  issues: ValidationIssue[];
  coverageGaps: CoverageGap[];
  itemVerdicts: Record<string, { verdict: '적정' | '적정(관리대상)' | '조건부 적정' | '부적정'; issues: ValidationIssue[] }>;
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
function gradeVal(g: string): number { return GRADE_ORDER[g] || 0; }

function getRecommendation(ruleType: string, field?: string): string {
  const recs: Record<string, string> = {
    'missing_field': field === 'hazard' ? '위험요인을 구체적으로 기재하세요 (예: 추락, 감전, 협착 등)'
      : field === 'hazard_situation' ? '위험이 발생하는 구체적 상황을 기술하세요'
      : field === 'existing_measure' ? '현재 적용 중인 안전조치를 기재하세요 (안전모 착용, 안전난간 설치 등)'
      : field === 'improvement_measure' ? '추가로 필요한 개선대책을 기재하세요 (구체적인 조치 내용 포함)'
      : '해당 필드를 기재하세요',
    'underestimation': '표준 라이브러리 기준 대비 등급이 낮습니다. 현장 상황을 재검토하여 등급을 조정하세요.',
    'insufficient_improvement': '위험도 상 항목은 개선 후 반드시 중 이하로 낮춰야 합니다. 구체적인 공학적/관리적 대책을 추가하세요.',
    'missing_legal': '관련 법적근거(산안법, 시행규칙 등)를 추가하세요.',
    'incomplete_completion': '완료/승인 상태 항목은 개선후 등급(가능성, 중대성)을 반드시 기재하세요.',
  };
  return recs[ruleType] || '항목을 보완하세요.';
}

export async function validateRiskItems(
  items: RiskItem[],
  projectId: string
): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];
  const itemVerdicts: Record<string, { verdict: '적정' | '적정(관리대상)' | '조건부 적정' | '부적정'; issues: ValidationIssue[] }> = {};

  const { data: library } = await supabase
    .from('standard_risk_library')
    .select('sub_task, hazard, default_likelihood_grade, default_severity_grade, category_large, category_medium')
    .eq('is_active', true);

  const { data: rules } = await supabase
    .from('validation_rules').select('*').eq('is_active', true);

  const ruleWeights: Record<string, number> = {};
  (rules || []).forEach(r => { ruleWeights[r.rule_type] = Number(r.weight) || 1; });

  for (const item of items) {
    const itemIssues: ValidationIssue[] = [];

    // 1) Required fields
    if (!item.hazard || item.hazard.trim() === '') {
      itemIssues.push({ riskItemId: item.id, ruleType: 'missing_field', severity: 'error', message: '위험요인 미기재', field: 'hazard', recommendation: getRecommendation('missing_field', 'hazard') });
    }
    if (!item.hazard_situation || item.hazard_situation.trim() === '') {
      itemIssues.push({ riskItemId: item.id, ruleType: 'missing_field', severity: 'error', message: '위험발생상황 미기재', field: 'hazard_situation', recommendation: getRecommendation('missing_field', 'hazard_situation') });
    }
    if (!item.existing_measure || item.existing_measure.trim() === '') {
      itemIssues.push({ riskItemId: item.id, ruleType: 'missing_field', severity: 'warning', message: '기존대책 미기재', field: 'existing_measure', recommendation: getRecommendation('missing_field', 'existing_measure') });
    }
    if (!item.improvement_measure || item.improvement_measure.trim() === '') {
      itemIssues.push({ riskItemId: item.id, ruleType: 'missing_field', severity: 'warning', message: '개선대책 미기재', field: 'improvement_measure', recommendation: getRecommendation('missing_field', 'improvement_measure') });
    }

    // 2) Underestimation
    if (library) {
      const match = library.find(l => l.sub_task === item.sub_task && l.hazard === item.hazard);
      if (match) {
        const libL = gradeVal(match.default_likelihood_grade);
        const libS = gradeVal(match.default_severity_grade);
        if (gradeVal(item.likelihood_grade) < libL || gradeVal(item.severity_grade) < libS) {
          itemIssues.push({
            riskItemId: item.id, ruleType: 'underestimation', severity: 'warning',
            message: `과소평가 의심 (라이브러리: 가능성 ${match.default_likelihood_grade}/중대성 ${match.default_severity_grade})`,
            recommendation: getRecommendation('underestimation'),
          });
        }
      }
    }

    // 3) High risk improvement check (revised policy)
    // 절대 규칙: 개선대책이 있으면 → 적정. 위험도 '상' 자체는 부적정 기준이 아님.
    const hasImprovement = item.improvement_measure && item.improvement_measure.trim().length >= 5;
    
    if (hasImprovement) {
      // 개선대책이 있으면 → 무조건 적정 (개선 후 위험도 상이면 관리대상)
      if (item.improved_risk_grade === '상') {
        itemIssues.push({ riskItemId: item.id, ruleType: 'managed_risk', severity: 'info',
          message: '개선 후에도 위험도 상 유지 → 적정(관리대상)', recommendation: '지속적 관리 및 피드백 등록이 필요합니다.' });
      }
    } else {
      // 개선대책 없음 → 부적정
      itemIssues.push({ riskItemId: item.id, ruleType: 'no_improvement', severity: 'error',
        message: '개선대책 미기재', field: 'improvement_measure', recommendation: '구체적인 개선대책을 기재하세요.' });
    }

    // 4) Legal basis
    if (item.risk_grade === '상' || item.risk_grade === '중') {
      if (!item.legal_basis || item.legal_basis.length === 0) {
        itemIssues.push({ riskItemId: item.id, ruleType: 'missing_legal', severity: 'warning',
          message: '법적근거 미기재 (위험도 중/상)', recommendation: getRecommendation('missing_legal') });
      }
    }

    // 5) Completion check
    if (['완료', '승인'].includes(item.status)) {
      if (!item.improved_likelihood_grade || !item.improved_severity_grade) {
        itemIssues.push({ riskItemId: item.id, ruleType: 'incomplete_completion', severity: 'warning',
          message: '완료/승인 상태이나 개선후 등급 미기재', recommendation: getRecommendation('incomplete_completion') });
      }
    }

    // 6) Missing department/assignee
    if (!item.department || item.department.trim() === '') {
      itemIssues.push({ riskItemId: item.id, ruleType: 'missing_field', severity: 'warning',
        message: '책임부서 미지정', field: 'department', recommendation: '책임부서를 지정하세요. 부서 선택 시 담당자가 자동 채워집니다.' });
    }
    if (!item.assignee || item.assignee.trim() === '') {
      itemIssues.push({ riskItemId: item.id, ruleType: 'missing_field', severity: 'warning',
        message: '담당자 미지정', field: 'assignee', recommendation: '담당자를 지정하세요. 책임부서 선택 시 자동 채워집니다.' });
    }

    // Per-item verdict (revised: managed_risk → 적정(관리대상))
    const itemErrors = itemIssues.filter(i => i.severity === 'error').length;
    const itemWarnings = itemIssues.filter(i => i.severity === 'warning').length;
    const hasManagedRisk = itemIssues.some(i => i.ruleType === 'managed_risk');
    let itemVerdict: '적정' | '적정(관리대상)' | '조건부 적정' | '부적정' = '적정';
    if (itemErrors > 0) itemVerdict = '부적정';
    else if (hasManagedRisk) itemVerdict = '적정(관리대상)';
    else if (itemWarnings > 0) itemVerdict = '조건부 적정';
    itemVerdicts[item.id] = { verdict: itemVerdict, issues: itemIssues };

    issues.push(...itemIssues);
  }

  // Coverage check
  const coverageGaps = await checkCoverage(items, projectId, library || []);

  // Calculate score
  const totalItems = items.length;
  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  const coveragePenalty = coverageGaps.filter(g => g.severity === '상').length * 10 + coverageGaps.filter(g => g.severity === '중').length * 5;
  const weightedPenalty = errors * 10 + warnings * 3 + coveragePenalty;
  const maxScore = Math.max(totalItems * 10, 1);
  const score = Math.max(0, Math.round(((maxScore - weightedPenalty) / maxScore) * 100));

  // Revised: improved_risk_grade === '상' WITH improvement is NOT 부적정 anymore
  const hasUnresolvedHigh = items.some(i => i.risk_grade === '상' && i.improved_risk_grade === '상' && (!i.improvement_measure || i.improvement_measure.trim().length < 5));
  const hasManagedItems = items.some(i => i.improved_risk_grade === '상' && i.improvement_measure && i.improvement_measure.trim().length >= 5);
  let verdict: '적정' | '적정(관리대상)' | '조건부 적정' | '부적정';
  if (errors > 0 || score < 60 || hasUnresolvedHigh) {
    verdict = '부적정';
  } else if (hasManagedItems) {
    verdict = '적정(관리대상)';
  } else if (coverageGaps.length > 0 || warnings > totalItems * 0.2 || score < 80) {
    verdict = '조건부 적정';
  } else {
    verdict = '적정';
  }

  return { totalItems, totalIssues: issues.length, errors, warnings, score, verdict, issues, coverageGaps, itemVerdicts };
}

async function checkCoverage(
  items: RiskItem[],
  projectId: string,
  library: any[]
): Promise<CoverageGap[]> {
  const gaps: CoverageGap[] = [];

  // Get target processes for this project's runs
  const { data: runs } = await supabase
    .from('assessment_runs')
    .select('target_processes')
    .eq('project_id', projectId);

  const targetProcesses = new Set<string>();
  (runs || []).forEach(r => {
    (r.target_processes || []).forEach((p: string) => targetProcesses.add(p));
  });

  if (targetProcesses.size === 0 || library.length === 0) return gaps;

  // For each target process, find expected hazards from library
  const itemKeys = new Set(items.map(i => `${i.sub_task}|||${i.hazard}`));

  for (const process of targetProcesses) {
    const expectedItems = library.filter(l =>
      l.category_large?.includes(process) || l.category_medium?.includes(process) || l.sub_task?.includes(process)
    );
    for (const expected of expectedItems) {
      const key = `${expected.sub_task}|||${expected.hazard}`;
      if (!itemKeys.has(key)) {
        const sev = gradeVal(expected.default_severity_grade) >= 3 ? '상' : gradeVal(expected.default_severity_grade) >= 2 ? '중' : '하';
        gaps.push({
          process,
          subTask: expected.sub_task,
          hazard: expected.hazard,
          severity: sev as '상' | '중' | '하',
          message: `${process} 공정에서 "${expected.sub_task} - ${expected.hazard}" 위험성평가가 누락되었습니다.`,
        });
      }
    }
  }

  return gaps;
}

export async function saveValidationResults(
  report: ValidationReport,
  projectId: string,
  userId: string,
  runId?: string,
  batchId?: string
): Promise<void> {
  const inserts = report.issues.map(issue => ({
    project_id: projectId,
    risk_item_id: issue.riskItemId,
    rule_id: null as string | null,
    status: issue.severity === 'error' ? 'fail' : 'warning',
    message: `[${issue.ruleType}] ${issue.message}`,
    batch_id: batchId || null,
    run_id: runId || null,
    validated_by: userId,
  }));

  if (runId) {
    await supabase.from('validation_results').delete().eq('run_id', runId);
  } else {
    await supabase.from('validation_results').delete().eq('project_id', projectId);
  }

  if (inserts.length > 0) {
    await supabase.from('validation_results').insert(inserts);
  }
}

// Validate imported Excel data
export function validateImportedItems(rows: Record<string, string>[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const validGrades = ['상', '중', '하'];

  rows.forEach((row, i) => {
    const id = `import-${i}`;
    if (!row['위험요인'] && !row['hazard']) {
      issues.push({ riskItemId: id, ruleType: 'missing_field', severity: 'error', message: `행 ${i + 1}: 위험요인 미기재`, field: 'hazard' });
    }
    if (!row['세부작업'] && !row['sub_task']) {
      issues.push({ riskItemId: id, ruleType: 'missing_field', severity: 'warning', message: `행 ${i + 1}: 세부작업 미기재`, field: 'sub_task' });
    }
    const lg = row['가능성'] || row['likelihood_grade'] || '';
    const sg = row['중대성'] || row['severity_grade'] || '';
    if (lg && !validGrades.includes(lg)) {
      issues.push({ riskItemId: id, ruleType: 'invalid_grade', severity: 'error', message: `행 ${i + 1}: 가능성 등급 '${lg}' 유효하지 않음 (상/중/하)`, field: 'likelihood_grade' });
    }
    if (sg && !validGrades.includes(sg)) {
      issues.push({ riskItemId: id, ruleType: 'invalid_grade', severity: 'error', message: `행 ${i + 1}: 중대성 등급 '${sg}' 유효하지 않음 (상/중/하)`, field: 'severity_grade' });
    }
    if (!row['개선대책'] && !row['improvement_measure']) {
      issues.push({ riskItemId: id, ruleType: 'missing_field', severity: 'warning', message: `행 ${i + 1}: 개선대책 미기재`, field: 'improvement_measure' });
    }
    if (!row['법적근거'] && !row['legal_basis']) {
      issues.push({ riskItemId: id, ruleType: 'missing_legal', severity: 'warning', message: `행 ${i + 1}: 법적근거 미기재`, field: 'legal_basis' });
    }
  });

  return issues;
}
