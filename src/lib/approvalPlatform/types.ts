import type { ApprovalEntityType } from '@/lib/approvalRules';

/** 전자결재 플랫폼 — 문서 draft steps (RPC jsonb와 동일 스키마) */
export type ApprovalDraftStep = {
  label: string;
  position: string;
  user_id: string;
  user_name: string;
  company_id: string | null;
  company_name: string;
};

export type DocumentApprovalDraftStatus = 'draft' | 'ready' | 'submitted' | 'superseded';

export type DocumentApprovalDraft = {
  id?: string;
  project_id: string;
  entity_type: ApprovalEntityType | string;
  entity_id: string;
  company_id: string | null;
  steps: ApprovalDraftStep[];
  status: DocumentApprovalDraftStatus;
  validation_errors: string[];
  ready_at?: string | null;
  submitted_at?: string | null;
  submitted_approval_version?: number | null;
  updated_at?: string;
};

export type UpsertDraftResult = {
  id: string;
  status: DocumentApprovalDraftStatus;
  ready: boolean;
  errors: string[];
  steps: ApprovalDraftStep[];
  updated_at?: string;
};
