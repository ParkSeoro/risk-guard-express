/**
 * Phase 2: Confirmation-Based Hybrid Document Vault.
 *
 * Design invariants (Antigravity ↔ Cursor consensus):
 *  1) Strict company_id tenant isolation — NEVER query or match across companies.
 *  2) Confirmation-only reuse — NEVER silently attach vault files; surface as
 *     explicit 1-click suggestions for empty, unlocked checklist slots.
 *  3) Expiry gate — NEVER suggest expired documents (`expiry_date < today`);
 *     return them separately so UI displays a clear warning to upload a fresh copy.
 *  4) Opt-in save — only persist to vault when the user explicitly opts in.
 */
import { supabase } from '@/integrations/supabase/client';
import { evaluateExpiryStatus, todayKstDateStr, type ExpiryStatus } from './workPlanOcrHelpers';
import { isCustomAttachmentKey } from './workPlanAttachments';

export interface CompanyVaultDoc {
  id: string;
  project_id: string;
  company_id: string;
  attachment_key: string;
  doc_name: string;
  file_url: string;
  file_path: string | null;
  file_size: number | null;
  mime_type: string | null;
  holder_name: string | null;
  reg_or_cert_no: string | null;
  expiry_date: string | null;
  updated_at: string;
}

export interface VaultChecklistRowLike {
  id: string;
  attachment_key: string;
  name: string;
  file_url: string | null;
  locked: boolean | null;
}

export interface VaultSuggestion {
  row: VaultChecklistRowLike;
  doc: CompanyVaultDoc;
  expiry: ExpiryStatus;
  daysRemaining: number | null;
}

function calcDaysRemaining(expiryDate: string | null, todayKst: string): number | null {
  if (!expiryDate || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) return null;
  const expMs = Date.parse(`${expiryDate}T00:00:00Z`);
  const todayMs = Date.parse(`${todayKst}T00:00:00Z`);
  if (!Number.isFinite(expMs) || !Number.isFinite(todayMs)) return null;
  return Math.floor((expMs - todayMs) / (24 * 60 * 60 * 1000));
}

export interface VaultClassification {
  /** Non-expired vault documents matching an empty, unlocked checklist row. */
  suggestable: VaultSuggestion[];
  /** Expired vault documents matching an empty, unlocked checklist row (blocked from suggestion). */
  expired: VaultSuggestion[];
}

/**
 * Custom ad-hoc attachments (`custom_*`) are one-off site proofs and are never
 * stored in or suggested from the reusable company vault.
 */
export function isReusableAttachmentKey(key?: string | null): boolean {
  const k = String(key || '').trim();
  if (!k) return false;
  return !isCustomAttachmentKey(k);
}

/**
 * Pure, testable matcher:
 * - Enforces `doc.company_id === expectedCompanyId` (defense-in-depth beyond RLS).
 * - Only matches empty (`!row.file_url`), unlocked (`!row.locked`) reusable slots.
 * - Excludes expired docs from `suggestable` and routes them to `expired`.
 */
export function classifyVaultSuggestions(
  vaultDocs: CompanyVaultDoc[],
  checklistRows: VaultChecklistRowLike[],
  expectedCompanyId: string | null | undefined,
  todayKst: string = todayKstDateStr(),
): VaultClassification {
  if (!expectedCompanyId) {
    return { suggestable: [], expired: [] };
  }

  const byKey = new Map<string, CompanyVaultDoc>();
  for (const doc of vaultDocs) {
    if (!doc || doc.company_id !== expectedCompanyId) continue;
    if (!doc.file_url || !isReusableAttachmentKey(doc.attachment_key)) continue;
    const prev = byKey.get(doc.attachment_key);
    if (!prev || String(doc.updated_at || '') > String(prev.updated_at || '')) {
      byKey.set(doc.attachment_key, doc);
    }
  }

  const suggestable: VaultSuggestion[] = [];
  const expired: VaultSuggestion[] = [];

  for (const row of checklistRows) {
    if (row.locked || row.file_url) continue;
    if (!isReusableAttachmentKey(row.attachment_key)) continue;
    const doc = byKey.get(row.attachment_key);
    if (!doc) continue;

    const expiry = evaluateExpiryStatus(doc.expiry_date, todayKst);
    const daysRemaining = calcDaysRemaining(doc.expiry_date, todayKst);
    if (expiry === 'expired') {
      expired.push({ row, doc, expiry, daysRemaining });
    } else {
      suggestable.push({ row, doc, expiry, daysRemaining });
    }
  }

  return { suggestable, expired };
}

/**
 * Fetch active reusable documents scoped strictly to `(projectId, companyId)`.
 * Returns empty array immediately if `companyId` is missing.
 */
export async function fetchCompanyVaultDocs(
  projectId: string,
  companyId: string | null | undefined,
): Promise<CompanyVaultDoc[]> {
  if (!projectId || !companyId) return [];
  const { data, error } = await (supabase as any)
    .from('company_document_vault')
    .select(
      'id, project_id, company_id, attachment_key, doc_name, file_url, file_path, file_size, mime_type, holder_name, reg_or_cert_no, expiry_date, updated_at',
    )
    .eq('project_id', projectId)
    .eq('company_id', companyId)
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false });

  if (error) {
    console.warn('[workPlanVault] fetch failed:', error.message);
    return [];
  }
  return (data ?? []) as CompanyVaultDoc[];
}

/**
 * Opt-in save/update of a reusable document in `company_document_vault`.
 * Uses select-then-update/insert to work cleanly with the partial unique index
 * `(project_id, company_id, attachment_key) WHERE is_deleted = false`.
 */
export async function saveCompanyVaultDoc(opts: {
  projectId: string;
  companyId: string | null | undefined;
  attachmentKey: string;
  docName: string;
  fileUrl: string;
  filePath?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  holderName?: string | null;
  regOrCertNo?: string | null;
  expiryDate?: string | null;
  sourceWorkPlanId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!opts.projectId || !opts.companyId) {
    return { ok: false, error: '업체 정보가 없어 보관함에 저장할 수 없습니다.' };
  }
  if (!isReusableAttachmentKey(opts.attachmentKey)) {
    return { ok: false, error: '기타 현장 증빙은 재사용 보관 대상이 아닙니다.' };
  }

  const nowIso = new Date().toISOString();
  const payload = {
    doc_name: opts.docName,
    file_url: opts.fileUrl,
    file_path: opts.filePath ?? null,
    file_size: opts.fileSize ?? null,
    mime_type: opts.mimeType ?? null,
    holder_name: opts.holderName ?? null,
    reg_or_cert_no: opts.regOrCertNo ?? null,
    expiry_date: opts.expiryDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.expiryDate) ? opts.expiryDate : null,
    source_work_plan_id: opts.sourceWorkPlanId ?? null,
    updated_at: nowIso,
  };

  const { data: existing, error: selErr } = await (supabase as any)
    .from('company_document_vault')
    .select('id')
    .eq('project_id', opts.projectId)
    .eq('company_id', opts.companyId)
    .eq('attachment_key', opts.attachmentKey)
    .eq('is_deleted', false)
    .maybeSingle();

  if (selErr) return { ok: false, error: selErr.message };

  if (existing?.id) {
    const { error } = await (supabase as any)
      .from('company_document_vault')
      .update(payload)
      .eq('id', existing.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const { data: userData } = await supabase.auth.getUser();
  const { error } = await (supabase as any)
    .from('company_document_vault')
    .insert({
      project_id: opts.projectId,
      company_id: opts.companyId,
      attachment_key: opts.attachmentKey,
      uploaded_by: userData?.user?.id ?? null,
      ...payload,
    });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Apply ONLY user-confirmed, non-expired vault suggestions to `work_plan_attachments`.
 * Re-checks expiry before writing as defense-in-depth.
 */
export async function applyVaultSuggestions(
  suggestions: VaultSuggestion[],
  todayKst: string = todayKstDateStr(),
): Promise<{ applied: number; skippedExpired: number; error?: string }> {
  let applied = 0;
  let skippedExpired = 0;

  for (const s of suggestions) {
    if (s.row.locked) continue;
    const expiry = evaluateExpiryStatus(s.doc.expiry_date, todayKst);
    if (expiry === 'expired') {
      skippedExpired += 1;
      continue;
    }
    const { error } = await supabase
      .from('work_plan_attachments')
      .update({
        file_url: s.doc.file_url,
        file_path: s.doc.file_path,
        file_size: s.doc.file_size,
        mime_type: s.doc.mime_type,
        source_type: 'auto_other',
        doc_expiry_date: s.doc.expiry_date && /^\d{4}-\d{2}-\d{2}$/.test(s.doc.expiry_date) ? s.doc.expiry_date : null,
        ocr_meta: (s.doc.holder_name || s.doc.reg_or_cert_no || s.doc.expiry_date)
          ? {
              docCategoryLabel: s.doc.doc_name || null,
              companyOrHolder: s.doc.holder_name ?? null,
              regOrCertNo: s.doc.reg_or_cert_no ?? null,
            }
          : null,
        ocr_checked_at: s.doc.expiry_date ? new Date().toISOString() : null,
      } as any)
      .eq('id', s.row.id);
    if (error) {
      return { applied, skippedExpired, error: error.message };
    }
    applied += 1;
  }

  return { applied, skippedExpired };
}
