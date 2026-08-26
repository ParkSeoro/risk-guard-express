// Risk Grade System: 상/중/하 (3-level)
export type RiskGrade = '상' | '중' | '하';

// Default 3x3 matrix
const DEFAULT_MATRIX: Record<string, RiskGrade> = {
  '상_상': '상', '상_중': '상', '중_상': '상',
  '상_하': '중', '중_중': '중', '하_상': '중',
  '중_하': '하', '하_중': '하', '하_하': '하',
};

const DEFAULT_COLORS: Record<RiskGrade, string> = {
  '상': '#ef4444',
  '중': '#eab308',
  '하': '#22c55e',
};

const DEFAULT_LABELS = {
  likelihood: '가능성',
  severity: '중대성',
  risk: '위험도',
};

export interface RiskMatrixConfig {
  matrix: Record<string, RiskGrade>;
  colors: Record<RiskGrade, string>;
  labels: { likelihood: string; severity: string; risk: string };
}

let cachedConfig: RiskMatrixConfig | null = null;

export function setMatrixConfig(config: RiskMatrixConfig) {
  cachedConfig = config;
}

export function getMatrixConfig(): RiskMatrixConfig {
  return cachedConfig || { matrix: DEFAULT_MATRIX, colors: DEFAULT_COLORS, labels: DEFAULT_LABELS };
}

export function calculateRiskGrade(
  likelihood: RiskGrade,
  severity: RiskGrade,
  matrix?: Record<string, RiskGrade>
): RiskGrade {
  const m = matrix || getMatrixConfig().matrix;
  return m[`${likelihood}_${severity}`] || '중';
}

export function getGradeClassName(grade: RiskGrade | string): string {
  if (grade === '상') return 'risk-high';
  if (grade === '중') return 'risk-medium';
  return 'risk-low';
}

export function getGradeColor(grade: RiskGrade | string): string {
  const colors = getMatrixConfig().colors;
  return colors[grade as RiskGrade] || DEFAULT_COLORS['하'];
}

export function getGradeSortOrder(grade: RiskGrade | string): number {
  if (grade === '상') return 3;
  if (grade === '중') return 2;
  return 1;
}

// Convert legacy numeric to grade
export function numericToGrade(value: number, type: 'frequency' | 'severity'): RiskGrade {
  if (value >= 4) return '상';
  if (value >= 3) return '중';
  return '하';
}

export function riskNumberToGrade(risk: number): RiskGrade {
  if (risk >= 16) return '상';
  if (risk >= 9) return '중';
  return '하';
}

export const GRADES: RiskGrade[] = ['상', '중', '하'];

/** Residual (개선후) likelihood: drop one level from initial when AI omits it. */
export function deriveResidualLikelihood(initial: RiskGrade | string | null | undefined): RiskGrade {
  if (initial === '상') return '중';
  if (initial === '중') return '하';
  return '하';
}

export type ResidualGrades = {
  likelihood: RiskGrade;
  severity: RiskGrade;
  risk: RiskGrade;
};

/**
 * 개선후 기본 규칙: 대책은 가능성을 한 단계 낮추고, 중대성은 유지한다.
 * Never flatten to 하/하/하 — that hides 관리대상(개선후 상) and 중 잔여.
 */
export function deriveResidualGrades(
  likelihood?: string | null,
  severity?: string | null,
): ResidualGrades {
  const lg = isValidRiskGrade(likelihood) ? likelihood : '중';
  const sg = isValidRiskGrade(severity) ? severity : '중';
  const ilg = deriveResidualLikelihood(lg);
  return { likelihood: ilg, severity: sg, risk: calculateRiskGrade(ilg, sg) };
}

export function derivedResidualFields(likelihood?: string | null, severity?: string | null) {
  const d = deriveResidualGrades(likelihood, severity);
  return {
    improved_likelihood_grade: d.likelihood,
    improved_severity_grade: d.severity,
    improved_risk_grade: d.risk,
  };
}

/**
 * Insert/fill default 하·하·하 is a placeholder, not a judged residual.
 * Real 하 residual keeps 개선후 중대성 = 초기 중대성 (usually 하 already).
 */
export function isFlattenedResidualPlaceholder(row: {
  likelihood_grade?: string | null;
  severity_grade?: string | null;
  risk_grade?: string | null;
  improved_likelihood_grade?: string | null;
  improved_severity_grade?: string | null;
  improved_risk_grade?: string | null;
}): boolean {
  const ilg = String(row.improved_likelihood_grade || '').trim();
  const isg = String(row.improved_severity_grade || '').trim();
  const irg = String(row.improved_risk_grade || '').trim();
  if (!ilg && !isg && !irg) return true;
  const allLow = (ilg === '하' || !ilg) && (isg === '하' || !isg) && (irg === '하' || !irg);
  if (!allLow) return false;
  const sg = String(row.severity_grade || '').trim();
  const rg = String(row.risk_grade || '').trim();
  return sg === '상' || sg === '중' || rg === '상' || rg === '중';
}

export function isValidRiskGrade(v: unknown): v is RiskGrade {
  return v === '상' || v === '중' || v === '하';
}
