import { supabase } from '@/integrations/supabase/client';
import type { ApprovalEntityType } from '@/lib/approvalRules';
import type { ApprovalDraftStep, DocumentApprovalDraft, UpsertDraftResult } from './types';

function asSteps(raw: unknown): ApprovalDraftStep[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s: any) => ({
    label: String(s?.label || s?.step_label || ''),
    position: String(s?.position || ''),
    user_id: String(s?.user_id || ''),
    user_name: String(s?.user_name || ''),
    company_id: s?.company_id ?? null,
    company_name: String(s?.company_name || ''),
  }));
}

function asErrors(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((e) => String(e));
}

/** 문서 draft 조회 (없으면 null). 테이블 미적용 환경에서는 null. */
export async function fetchDocumentApprovalDraft(
  entityType: ApprovalEntityType | string,
  entityId: string,
): Promise<DocumentApprovalDraft | null> {
  const { data, error } = await (supabase as any)
    .from('document_approval_drafts')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .maybeSingle();

  if (error) {
    // relation missing until SQL applied
    if (String(error.message || '').includes('document_approval_drafts')) return null;
    console.warn('[approvalPlatform] fetch draft failed:', error);
    return null;
  }
  if (!data) return null;

  return {
    id: data.id,
    project_id: data.project_id,
    entity_type: data.entity_type,
    entity_id: data.entity_id,
    company_id: data.company_id,
    steps: asSteps(data.steps),
    status: data.status,
    validation_errors: asErrors(data.validation_errors),
    ready_at: data.ready_at,
    submitted_at: data.submitted_at,
    submitted_approval_version: data.submitted_approval_version,
    updated_at: data.updated_at,
  };
}

/** 결재선 설정 저장 (상신과 분리) */
export async function upsertDocumentApprovalDraft(args: {
  entityType: ApprovalEntityType | string;
  entityId: string;
  projectId: string;
  companyId?: string | null;
  steps: ApprovalDraftStep[];
}): Promise<{ data: UpsertDraftResult | null; error: string | null }> {
  const { data, error } = await (supabase as any).rpc('upsert_document_approval_draft', {
    _entity_type: args.entityType,
    _entity_id: args.entityId,
    _project_id: args.projectId,
    _company_id: args.companyId || null,
    _steps: args.steps,
  });

  if (error) {
    return { data: null, error: error.message || String(error) };
  }

  const row = data as any;
  return {
    data: {
      id: row.id,
      status: row.status,
      ready: !!row.ready,
      errors: asErrors(row.errors),
      steps: asSteps(row.steps),
      updated_at: row.updated_at,
    },
    error: null,
  };
}

/** ready draft만 상신 — 기존 submit_approval 을 서버에서 호출 */
export async function submitApprovalFromDraft(args: {
  entityType: ApprovalEntityType | string;
  entityId: string;
  reason?: string | null;
}): Promise<{ inserted: number | null; error: string | null }> {
  const { data, error } = await (supabase as any).rpc('submit_approval_from_draft', {
    _entity_type: args.entityType,
    _entity_id: args.entityId,
    _reason: args.reason || null,
  });

  if (error) {
    return { inserted: null, error: error.message || String(error) };
  }
  return { inserted: typeof data === 'number' ? data : Number(data), error: null };
}
