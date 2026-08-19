import { sortStepsByHierarchy } from '@/lib/approvalRules';
import { jobTitleLabel, localizePersonName } from '@/lib/jobTitleLabel';

/** 위험성평가 인쇄·화면·XLSX 서명란 한 행 */
export type AssessmentSignatureRow = {
  step: string;
  approver_name: string;
  company_name: string;
  position: string;
  position_label: string;
  status: string;
  approved_at: string | null;
};

export type SignatureApprovalInput = {
  step?: string | null;
  step_label?: string | null;
  step_order?: number | null;
  approver_name?: string | null;
  user_name?: string | null;
  company_name?: string | null;
  position?: string | null;
  status?: string | null;
  approved_at?: string | null;
  approval_version?: number | null;
};

export type SignatureDraftStepInput = {
  label?: string | null;
  step_label?: string | null;
  position?: string | null;
  user_id?: string | null;
  user_name?: string | null;
  company_id?: string | null;
  company_name?: string | null;
};


/**
 * 서명란 SSOT: 상신 후면 해당 버전 approvals 전체, 상신 전이면 저장된 결재선 초안.
 * 작성/검토/승인 3칸·참여자 5역할 폴백은 쓰지 않는다.
 */
export function buildAssessmentSignatureRows(opts: {
  approvals?: SignatureApprovalInput[] | null;
  draftSteps?: SignatureDraftStepInput[] | null;
}): AssessmentSignatureRow[] {
  const all = (opts.approvals || []).filter((a) => (a.status || '') !== '취소');
  if (all.length > 0) {
    const version = Math.max(0, ...all.map((a) => Number(a.approval_version) || 1));
    const latest = all.filter((a) => (Number(a.approval_version) || 1) === version);
    const sorted = sortStepsByHierarchy(
      [...latest].sort((a, b) => (a.step_order ?? 99) - (b.step_order ?? 99)),
    );
    return sorted.map((a) => ({
      step: a.step || a.step_label || '',
      approver_name: localizePersonName(a.approver_name || a.user_name || ''),
      company_name: a.company_name || '',
      position: a.position || '',
      position_label: jobTitleLabel(a.position),
      status: a.status || '',
      approved_at: a.approved_at || null,
    }));
  }

  const steps = (opts.draftSteps || []).filter(
    (s) => !!(s.position || s.label || s.step_label || s.user_id || s.user_name),
  );
  return steps.map((s) => ({
    step: s.label || s.step_label || '',
    approver_name: localizePersonName(s.user_name || ''),
    company_name: s.company_name || '',
    position: s.position || '',
    position_label: jobTitleLabel(s.position),
    status: '',
    approved_at: null,
  }));
}
