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
