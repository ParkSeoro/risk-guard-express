/**
 * Work-permit approval → form signature slot binding (SSOT).
 *
 * Each approvals row has its own approved_at. Never copy document-level
 * work_permits.approved_at / signatures.reviewed_at into every stamp cell.
 */
import type { PermitSignatures } from '@/components/permits/DigPermitForm';

export type ApprovalStampRow = {
  position?: string | null;
  approver_name?: string | null;
  approved_at?: string | null;
  status?: string | null;
};

/** Unified approval position → DigPermitForm signature slot */
export const POSITION_TO_SIG: Record<string, keyof PermitSignatures> = {
  contractor_supervisor: 'contractor_pic',
  contractor_pic: 'contractor_pic',
  contractor_safety_manager: 'safety_pic',
  safety_pic: 'safety_pic',
  contractor_site_director: 'site_director',
  site_director: 'site_director',
  site_supervisor: 'site_supervisor',
  gc: 'gc_manager',
  gc_manager: 'gc_manager',
  gc_pm: 'gc_manager',
  owner_cm: 'cm',
  cm: 'cm',
  owner_sm: 'sm',
  sm: 'sm',
  closure_sm: 'closure_approver',
};

export const ROLE_ALIAS_TO_SIG: Record<string, keyof PermitSignatures> = {
  contractor_pic: 'contractor_pic',
  applicant: 'contractor_pic',
  requester: 'contractor_pic',
  contractor_supervisor: 'contractor_pic',
  '담당자(시공)': 'contractor_pic',
  '시공담당': 'contractor_pic',
  '시공': 'contractor_pic',
  cm: 'cm',
  owner_cm: 'cm',
  construction_manager: 'cm',
  '담당자(CM)': 'cm',
  CM: 'cm',
  safety_pic: 'safety_pic',
  contractor_safety_manager: 'safety_pic',
  safety_manager: 'safety_pic',
  '담당자(안전)': 'safety_pic',
  '안전담당': 'safety_pic',
  '안전관리자': 'safety_pic',
  sm: 'sm',
  owner_sm: 'sm',
  safety_management: 'sm',
  '담당자(SM)': 'sm',
  SM: 'sm',
  site_director: 'site_director',
  contractor_site_director: 'site_director',
  site_manager: 'site_director',
  '책임자(소장)': 'site_director',
  '소장': 'site_director',
  '현장소장': 'site_director',
  site_supervisor: 'site_supervisor',
  supervisor: 'site_supervisor',
  '현장감독자': 'site_supervisor',
  gc: 'gc_manager',
  gc_manager: 'gc_manager',
  gc_pm: 'gc_manager',
  '시공사 관리자': 'gc_manager',
  '시공사관리자': 'gc_manager',
  closure_sm: 'closure_approver',
  closure_approver: 'closure_approver',
};

export function resolveSigKey(
  role?: string | null,
  position?: string | null,
): keyof PermitSignatures | null {
  const keys = [role, position].filter(Boolean) as string[];
  for (const k of keys) {
    if (ROLE_ALIAS_TO_SIG[k]) return ROLE_ALIAS_TO_SIG[k];
    const lower = k.toLowerCase();
    if (ROLE_ALIAS_TO_SIG[lower]) return ROLE_ALIAS_TO_SIG[lower];
    if (POSITION_TO_SIG[lower]) return POSITION_TO_SIG[lower];
  }
  return null;
}

function isApprovedStatus(status?: string | null): boolean {
  if (!status) return true; // treat missing as approved when reading historical rows
  const s = status.toLowerCase();
  return status === '승인' || s === 'approved';
}

/**
 * Merge approval-line rows into per-slot signatures.
 * Each slot.signed_at comes ONLY from that row's approved_at (never a shared document clock).
 */
export function mergeApprovalSignatures(
  baseSig: PermitSignatures,
  approvals: ApprovalStampRow[],
): PermitSignatures {
  const merged: PermitSignatures = { ...baseSig };
  let cmAt: string | undefined;
  let smAt: string | undefined;
  let closedAt: string | undefined;

  for (const a of approvals) {
    if (!isApprovedStatus(a.status)) continue;
    const pos = (a.position || '').toLowerCase();
    const sigKey = POSITION_TO_SIG[pos] || resolveSigKey(null, a.position);
    if (!sigKey) continue;

    const existing = (merged as Record<string, any>)[sigKey];
    // Always overwrite name + signed_at from THIS approval row (independent clock).
    // Keep hand-drawn signature image if present.
    (merged as Record<string, any>)[sigKey] = {
      name: a.approver_name || existing?.name || '',
      signature: existing?.signature || '',
      signed_at: a.approved_at || existing?.signed_at || '',
    };

    if ((pos === 'owner_cm' || pos === 'cm') && a.approved_at) cmAt = a.approved_at;
    if ((pos === 'owner_sm' || pos === 'sm') && a.approved_at) smAt = a.approved_at;
    if (pos === 'closure_sm' && a.approved_at) closedAt = a.approved_at;
  }

  // Legacy top-level mirrors for older consumers — NOT for DigPermitForm stamp cells.
  if (cmAt) merged.reviewed_at = cmAt;
  if (smAt) merged.approved_at = smAt;
  if (closedAt) merged.closed_at = closedAt;
  return merged;
}

/** Per-role signed_at for UI/PDF — never fall back to document approved_at. */
export function slotSignedAt(
  signatures: PermitSignatures | null | undefined,
  key: keyof PermitSignatures,
): string | undefined {
  const slot = signatures?.[key] as { signed_at?: string } | undefined;
  const at = slot?.signed_at;
  return at && String(at).trim() ? String(at) : undefined;
}
