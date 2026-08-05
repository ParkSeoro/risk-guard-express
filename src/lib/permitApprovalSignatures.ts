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
  closure_supervisor: 'site_supervisor',
  extend_sm: 'extension_approver',
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
  closure_supervisor: 'site_supervisor',
  extend_sm: 'extension_approver',
  extension_approver: 'extension_approver',
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
    // Never reuse a shared/stale signed_at from baseSig when this row has approved_at.
    // Keep hand-drawn signature image if present.
    const rowAt = a.approved_at ? String(a.approved_at) : '';
    const slot = {
      name: a.approver_name || existing?.name || '',
      signature: existing?.signature || '',
      signed_at: rowAt || existing?.signed_at || '',
    };
    (merged as Record<string, any>)[sigKey] = slot;

    // Special forms (화기/밀폐/굴착) bind 신청인 to signatures.applicant, while the
    // approval SSOT stamps contractor_pic. Mirror so 성명/서명 cells fill after approve.
    if (sigKey === 'contractor_pic') {
      const appExisting = (merged as Record<string, any>).applicant;
      (merged as Record<string, any>).applicant = {
        name: slot.name || appExisting?.name || '',
        signature: appExisting?.signature || slot.signature || '',
        signed_at: slot.signed_at || appExisting?.signed_at || '',
      };
    }

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

type SigSlot = { name?: string; signature?: string; signed_at?: string };

export function sigSlotHasContent(slot?: SigSlot | null): boolean {
  if (!slot) return false;
  return (
    !!(slot.name && String(slot.name).trim()) ||
    !!(slot.signature && String(slot.signature).trim()) ||
    !!(slot.signed_at && String(slot.signed_at).trim())
  );
}

/**
 * Special forms (화기/밀폐/굴착) bind paper rows to keys that do not match
 * issuance approval SSOT. Remap so stamps fill after approve:
 *
 * - applicant → applicant || contractor_pic
 * - site_supervisor (관리감독자) → always contractor_pic (상신 관리감독자;
 *   closure_supervisor must not replace this paper row)
 * - closure_approver (승인자) → closure_approver || sm (작업완료 있으면 우선,
 *   없으면 발급 SM)
 */
export function resolveSpecialFormSigSlot(
  signatures: PermitSignatures | null | undefined,
  key: keyof PermitSignatures,
): SigSlot | undefined {
  const sig = signatures || {};
  const primary = sig[key] as SigSlot | undefined;
  if (key === 'applicant') {
    return sigSlotHasContent(primary) ? primary : (sig.contractor_pic as SigSlot | undefined);
  }
  if (key === 'site_supervisor') {
    const issuance = sig.contractor_pic as SigSlot | undefined;
    return sigSlotHasContent(issuance) ? issuance : primary;
  }
  if (key === 'closure_approver') {
    return sigSlotHasContent(primary) ? primary : (sig.sm as SigSlot | undefined);
  }
  return primary;
}

export type ApprovalPhoneRow = {
  position?: string | null;
  status?: string | null;
  approver_id?: string | null;
};

/** Map issuance approver profile phones → DigPermitForm contact fields. */
export function contactPhonesFromApprovals(
  approvals: ApprovalPhoneRow[],
  phonesByUserId: Record<string, string | null | undefined>,
): { safety_manager_phone?: string; supervisor_phone?: string } {
  let safety_manager_phone: string | undefined;
  let supervisor_phone: string | undefined;
  for (const a of approvals) {
    if (!isApprovedStatus(a.status)) continue;
    const pos = (a.position || '').toLowerCase();
    const uid = a.approver_id || '';
    const phone = (phonesByUserId[uid] || '').trim();
    if (!phone) continue;
    if (pos === 'contractor_safety_manager' || pos === 'safety_pic') {
      safety_manager_phone = phone;
    }
    if (pos === 'contractor_supervisor' || pos === 'contractor_pic') {
      supervisor_phone = phone;
    }
  }
  return { safety_manager_phone, supervisor_phone };
}
