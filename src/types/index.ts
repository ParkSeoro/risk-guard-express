export type ImplementationStatus = '미착수' | '진행' | '완료';

export interface Project {
  id: string;
  name: string;
  siteName: string;
  period: { start: string; end: string };
  client: string;
  contractor: string;
  subcontractors: string[];
  tags: string[];
  status: '진행중' | '완료' | '보류';
}

export interface RiskItem {
  id: string;
  projectId: string;
  process: string;
  subTask: string;
  hazard: string;
  hazardSituation: string;
  existingMeasure: string;
  improvementMeasure: string;
  // Legacy numeric fields
  frequency: number;
  severity: number;
  risk: number;
  improvedFrequency: number;
  improvedSeverity: number;
  improvedRisk: number;
  // New grade fields
  likelihoodGrade: '상' | '중' | '하';
  severityGrade: '상' | '중' | '하';
  riskGrade: '상' | '중' | '하';
  improvedLikelihoodGrade: '상' | '중' | '하';
  improvedSeverityGrade: '상' | '중' | '하';
  improvedRiskGrade: '상' | '중' | '하';
  status: ImplementationStatus;
  ppe: string[];
  legalBasis: string[];
  department: string;
  assignee: string;
  note: string;
  attachments: string[];
}

export interface MasterProcess {
  id: string;
  name: string;
  category: string;
}

export interface MasterPPE {
  id: string;
  name: string;
  icon?: string;
}

export interface MasterLegalBasis {
  id: string;
  code: string;
  description: string;
}

export interface MasterDepartment {
  id: string;
  name: string;
}

export interface MasterAssignee {
  id: string;
  name: string;
  departmentId: string;
  position: string;
  phone: string;
}

export interface ApprovalStep {
  id: string;
  riskItemId: string;
  step: '작성' | '검토' | '승인';
  status: '대기' | '승인' | '반려';
  approver: string;
  comment: string;
  timestamp: string;
}

// Legacy helpers (kept for backward compat)
export function getRiskLevel(risk: number): 'high' | 'medium' | 'low' {
  if (risk >= 16) return 'high';
  if (risk >= 9) return 'medium';
  return 'low';
}

export function getRiskClassName(risk: number): string {
  const level = getRiskLevel(risk);
  if (level === 'high') return 'risk-high';
  if (level === 'medium') return 'risk-medium';
  return 'risk-low';
}
