/**
 * Equipment Master -> Work Plan 1-Click Linking Helper.
 *
 * When a user selects an equipment item in the WorkPlanDetail `장비` tab:
 *  1) Merges equipment specs into the `equipment` body section (non-destructive).
 *  2) Matches the equipment's stored master docs (등록증·정기검사증·보험증권·제원표)
 *     onto unlocked `work_plan_attachments` slots.
 *  3) Enforces expiry gate: expired inspection/insurance docs are NEVER linked
 *     and are returned in `expiredSkipped` for explicit user warning.
 */
import { supabase } from '@/integrations/supabase/client';
import { evaluateExpiryStatus, todayKstDateStr } from './workPlanOcrHelpers';

export interface EquipmentMasterItem {
  id?: string;
  project_id: string;
  company_id: string | null;
  name: string;
  rated_capacity: number | null;
  manufacturer: string;
  model_name: string;
  is_default: boolean;
  reg_cert_url?: string | null;
  inspection_cert_url?: string | null;
  inspection_expiry_date?: string | null;
  insurance_url?: string | null;
  insurance_expiry_date?: string | null;
  spec_sheet_url?: string | null;
}

export interface EquipmentAttachmentSlotLike {
  id: string;
  attachment_key: string;
  name: string;
  file_url: string | null;
  locked: boolean | null;
}

export interface EquipmentDocMatch {
  rowId: string;
  rowName: string;
  docLabel: string;
  fileUrl: string;
}

export interface EquipmentDocMatchResult {
  matches: EquipmentDocMatch[];
  expiredSkipped: Array<{ docLabel: string; expiryDate: string }>;
}

/**
 * Pure helper: merges selected equipment into the `equipment` section JSON array.
 * Replaces a single empty placeholder row, updates same-name row, or appends cleanly.
 */
export function mergeEquipmentIntoSection(
  currentValue: string | null | undefined,
  eq: Pick<EquipmentMasterItem, 'name' | 'model_name' | 'rated_capacity' | 'manufacturer' | 'inspection_expiry_date'>,
): string {
  let rows: Array<{
    name: string;
    model: string;
    capacity: string;
    manufacturer: string;
    inspection_date: string;
  }> = [];

  if (currentValue) {
    try {
      const parsed = JSON.parse(currentValue);
      if (Array.isArray(parsed)) rows = parsed;
    } catch {
      rows = [];
    }
  }

  const nextEntry = {
    name: eq.name || '',
    model: eq.model_name || '',
    capacity: eq.rated_capacity != null ? String(eq.rated_capacity) : '',
    manufacturer: eq.manufacturer || '',
    inspection_date: eq.inspection_expiry_date || '',
  };

  // Drop empty placeholder rows
  const meaningful = rows.filter(
    (r) =>
      r &&
      (String(r.name || '').trim() !== '' ||
        String(r.model || '').trim() !== '' ||
        String(r.manufacturer || '').trim() !== ''),
  );

  const dupIdx = meaningful.findIndex(
    (r) => String(r.name || '').trim().toLowerCase() === nextEntry.name.trim().toLowerCase(),
  );
  if (dupIdx >= 0) {
    meaningful[dupIdx] = {
      ...meaningful[dupIdx],
      ...nextEntry,
      model: nextEntry.model || meaningful[dupIdx].model,
      capacity: nextEntry.capacity || meaningful[dupIdx].capacity,
      manufacturer: nextEntry.manufacturer || meaningful[dupIdx].manufacturer,
      inspection_date: nextEntry.inspection_date || meaningful[dupIdx].inspection_date,
    };
  } else {
    meaningful.push(nextEntry);
  }

  return JSON.stringify(meaningful);
}

const DOC_SLOT_RULES: Array<{
  field: 'reg_cert_url' | 'inspection_cert_url' | 'insurance_url' | 'spec_sheet_url';
  expiryField?: 'inspection_expiry_date' | 'insurance_expiry_date';
  docLabel: string;
  keyPattern: RegExp;
  namePattern: RegExp;
}> = [
  {
    field: 'reg_cert_url',
    docLabel: '장비 등록증',
    keyPattern: /(reg_cert|vehicle_reg|equipment_reg|등록증)/i,
    namePattern: /(등록증)/,
  },
  {
    field: 'inspection_cert_url',
    expiryField: 'inspection_expiry_date',
    docLabel: '정기·안전검사증',
    keyPattern: /(inspection|safety_cert|check_cert|검사)/i,
    namePattern: /(정기검사|안전검사|검사증|검사합격)/,
  },
  {
    field: 'insurance_url',
    expiryField: 'insurance_expiry_date',
    docLabel: '장비 보험증권',
    keyPattern: /(equip_insurance|vehicle_insurance|insurance_cert|보험)/i,
    namePattern: /(건설기계.*보험|차량.*보험|장비.*보험|보험증권)/,
  },
  {
    field: 'spec_sheet_url',
    docLabel: '장비 제원표',
    keyPattern: /(spec|제원)/i,
    namePattern: /(제원표|규격표)/,
  },
];

/**
 * Pure helper: matches equipment master documents to unlocked checklist rows,
 * skipping any expired inspection/insurance docs.
 */
export function matchEquipmentDocsToAttachments(
  eq: EquipmentMasterItem,
  rows: EquipmentAttachmentSlotLike[],
  todayKst: string = todayKstDateStr(),
): EquipmentDocMatchResult {
  const matches: EquipmentDocMatch[] = [];
  const expiredSkipped: Array<{ docLabel: string; expiryDate: string }> = [];
  const usedRowIds = new Set<string>();

  for (const rule of DOC_SLOT_RULES) {
    const fileUrl = eq[rule.field];
    if (!fileUrl) continue;

    if (rule.expiryField) {
      const exp = eq[rule.expiryField];
      if (exp && evaluateExpiryStatus(exp, todayKst) === 'expired') {
        expiredSkipped.push({ docLabel: rule.docLabel, expiryDate: exp });
        continue;
      }
    }

    // Prefer an empty unlocked matching row first, then any unlocked matching row
    const candidates = rows.filter(
      (r) =>
        !r.locked &&
        !usedRowIds.has(r.id) &&
        (rule.keyPattern.test(r.attachment_key) || rule.namePattern.test(r.name)),
    );
    const target = candidates.find((r) => !r.file_url) ?? candidates[0];
    if (!target) continue;

    usedRowIds.add(target.id);
    matches.push({
      rowId: target.id,
      rowName: target.name,
      docLabel: rule.docLabel,
      fileUrl,
    });
  }

  return { matches, expiredSkipped };
}

/**
 * Links valid (non-expired) equipment master docs into `work_plan_attachments`.
 */
export async function applyEquipmentDocsToWorkPlan(
  workPlanId: string,
  eq: EquipmentMasterItem,
): Promise<{ linkedNames: string[]; expiredSkipped: Array<{ docLabel: string; expiryDate: string }>; error?: string }> {
  const hasAnyDoc = !!(eq.reg_cert_url || eq.inspection_cert_url || eq.insurance_url || eq.spec_sheet_url);
  if (!hasAnyDoc) {
    return { linkedNames: [], expiredSkipped: [] };
  }

  const { data, error } = await supabase
    .from('work_plan_attachments')
    .select('id, attachment_key, name, file_url, locked')
    .eq('work_plan_id', workPlanId)
    .eq('is_deleted', false);
  if (error) {
    return { linkedNames: [], expiredSkipped: [], error: error.message };
  }

  const { matches, expiredSkipped } = matchEquipmentDocsToAttachments(
    eq,
    (data ?? []) as EquipmentAttachmentSlotLike[],
  );

  const linkedNames: string[] = [];
  for (const m of matches) {
    const { error: upErr } = await supabase
      .from('work_plan_attachments')
      .update({
        file_url: m.fileUrl,
        source_type: 'auto_equipment',
        source_table: 'equipment_master',
        source_ref_id: eq.id ?? null,
      })
      .eq('id', m.rowId);
    if (upErr) {
      return { linkedNames, expiredSkipped, error: upErr.message };
    }
    linkedNames.push(m.rowName);
  }

  return { linkedNames, expiredSkipped };
}
