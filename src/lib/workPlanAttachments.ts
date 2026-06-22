/**
 * 작업계획서 첨부 통합 매니저.
 *
 * 책임:
 *  1) 공종/조건 기반 필수 첨부 행을 work_plan_attachments 에 초기화 (idempotent)
 *  2) 장비DB / MSDS / 작업환경측정 / 자격증 등 다른 모듈 데이터를 자동 첨부
 *  3) 결재 제출 전 법정 필수(legal & required) 미첨부 항목 차단 가이드 제공
 */
import { supabase } from '@/integrations/supabase/client';
import {
  generateAttachments, withKind, getMandatoryLegalAttachments,
  type AttachmentItem,
} from './attachmentTemplates';

export interface AttachmentBlocker {
  key: string;
  name: string;
  hint: string;
}

/**
 * 작업계획서 생성/공종 변경 시 호출 — 템플릿 기반 빈 행을 미리 만들어 둠.
 * file_url 은 비워두고, 사용자가 업로드하면 update.
 */
export async function syncTemplateRows(opts: {
  workPlanId: string;
  projectId: string;
  companyId?: string | null;
  workType: string;
  conditions?: Record<string, string>;
}) {
  const items = generateAttachments(opts.workType, opts.conditions).map(withKind);
  const { data: existing } = await supabase
    .from('work_plan_attachments')
    .select('attachment_key')
    .eq('work_plan_id', opts.workPlanId)
    .eq('is_deleted', false);
  const existingKeys = new Set((existing ?? []).map((r: any) => r.attachment_key));
  const rows = items
    .filter(i => !existingKeys.has(i.key))
    .map(i => ({
      work_plan_id: opts.workPlanId,
      project_id: opts.projectId,
      company_id: opts.companyId ?? null,
      category: i.kind ?? 'site_proof',
      attachment_key: i.key,
      name: i.name,
      description: i.description,
      is_mandatory: i.required && i.kind === 'legal',
      source_type: 'manual' as const,
    }));
  if (rows.length === 0) return { inserted: 0 };
  const { error, count } = await supabase
    .from('work_plan_attachments')
    .insert(rows, { count: 'exact' });
  if (error) throw error;
  return { inserted: count ?? rows.length };
}

/**
 * 결재 차단 검증 — 법정 필수 항목 중 file_url 미입력 행 반환.
 * 빈 배열이면 결재 진행 가능.
 */
export async function getApprovalBlockers(workPlanId: string, workType: string): Promise<AttachmentBlocker[]> {
  const required = getMandatoryLegalAttachments(workType);
  if (required.length === 0) return [];

  const { data } = await supabase
    .from('work_plan_attachments')
    .select('attachment_key, file_url')
    .eq('work_plan_id', workPlanId)
    .eq('is_deleted', false);
  const uploaded = new Set(
    (data ?? []).filter((r: any) => r.file_url).map((r: any) => r.attachment_key),
  );
  return required
    .filter(r => !uploaded.has(r.key))
    .map(r => ({
      key: r.key,
      name: r.name,
      hint: r.description || '법정 필수 첨부입니다. 업로드 후 결재를 상신하세요.',
    }));
}

/**
 * 장비DB(equipment_master)에서 검사증/제원표 자동 첨부.
 * equipmentIds 는 작업계획서에서 선택된 장비들.
 */
export async function autoAttachEquipment(opts: {
  workPlanId: string;
  projectId: string;
  companyId?: string | null;
  equipmentIds: string[];
}) {
  if (opts.equipmentIds.length === 0) return { inserted: 0 };
  const { data: equips } = await supabase
    .from('equipment_master')
    .select('id, name, inspection_cert_url, spec_sheet_url')
    .in('id', opts.equipmentIds);
  if (!equips || equips.length === 0) return { inserted: 0 };

  const rows: any[] = [];
  for (const e of equips as any[]) {
    if (e.inspection_cert_url) {
      rows.push(makeAutoRow(opts, {
        key: `auto_inspection_${e.id}`,
        name: `[자동] ${e.name} 안전검사증`,
        category: 'legal',
        is_mandatory: true,
        source_type: 'auto_equipment',
        source_table: 'equipment_master',
        source_ref_id: e.id,
        file_url: e.inspection_cert_url,
      }));
    }
    if (e.spec_sheet_url) {
      rows.push(makeAutoRow(opts, {
        key: `auto_spec_${e.id}`,
        name: `[자동] ${e.name} 제원표`,
        category: 'calc_evidence',
        is_mandatory: false,
        source_type: 'auto_equipment',
        source_table: 'equipment_master',
        source_ref_id: e.id,
        file_url: e.spec_sheet_url,
      }));
    }
  }
  return upsertAuto(rows);
}

/**
 * 화학물질(chemicals) MSDS 자동 첨부.
 */
export async function autoAttachMSDS(opts: {
  workPlanId: string;
  projectId: string;
  companyId?: string | null;
  chemicalIds: string[];
}) {
  if (opts.chemicalIds.length === 0) return { inserted: 0 };
  const { data } = await supabase
    .from('chemicals')
    .select('id, name, msds_file_url')
    .in('id', opts.chemicalIds);
  const rows = (data ?? [])
    .filter((c: any) => c.msds_file_url)
    .map((c: any) => makeAutoRow(opts, {
      key: `auto_msds_${c.id}`,
      name: `[자동] MSDS - ${c.name}`,
      category: 'legal',
      is_mandatory: true,
      source_type: 'auto_msds',
      source_table: 'chemicals',
      source_ref_id: c.id,
      file_url: c.msds_file_url,
    }));
  return upsertAuto(rows);
}

/**
 * 작업환경측정 결과 자동 첨부.
 */
export async function autoAttachEnvMeasurements(opts: {
  workPlanId: string;
  projectId: string;
  companyId?: string | null;
  measurementIds: string[];
}) {
  if (opts.measurementIds.length === 0) return { inserted: 0 };
  const { data } = await supabase
    .from('work_env_measurements')
    .select('id, report_file_url, factor_id, measured_at')
    .in('id', opts.measurementIds);
  const rows = (data ?? [])
    .filter((m: any) => m.report_file_url)
    .map((m: any) => makeAutoRow(opts, {
      key: `auto_env_${m.id}`,
      name: `[자동] 작업환경측정 결과 (${m.measured_at ?? ''})`,
      category: 'legal',
      is_mandatory: true,
      source_type: 'auto_env_measurement',
      source_table: 'work_env_measurements',
      source_ref_id: m.id,
      file_url: m.report_file_url,
    }));
  return upsertAuto(rows);
}

/* ---------- internals ---------- */
function makeAutoRow(
  base: { workPlanId: string; projectId: string; companyId?: string | null },
  fields: Record<string, any>,
) {
  return {
    work_plan_id: base.workPlanId,
    project_id: base.projectId,
    company_id: base.companyId ?? null,
    ...fields,
  };
}

async function upsertAuto(rows: any[]) {
  if (rows.length === 0) return { inserted: 0 };
  const { error, count } = await supabase
    .from('work_plan_attachments')
    .upsert(rows, { onConflict: 'work_plan_id,attachment_key', count: 'exact' });
  if (error) throw error;
  return { inserted: count ?? rows.length };
}

export type { AttachmentItem };
