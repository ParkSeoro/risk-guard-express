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
      // 공종별 required 전부 필수 — 결재·인쇄 누락 안내의 SSOT
      is_mandatory: !!i.required,
      source_type: 'manual' as const,
    }));

  // Repair mandatory flags on existing rows (template drift / legacy legal-only flags)
  for (const i of items) {
    if (!existingKeys.has(i.key)) continue;
    const mandatory = !!i.required;
    await supabase
      .from('work_plan_attachments')
      .update({
        is_mandatory: mandatory,
        category: i.kind ?? 'site_proof',
        name: i.name,
        description: i.description,
      })
      .eq('work_plan_id', opts.workPlanId)
      .eq('attachment_key', i.key)
      .eq('is_deleted', false);
  }

  if (rows.length === 0) return { inserted: 0 };
  const { error, count } = await supabase
    .from('work_plan_attachments')
    .insert(rows, { count: 'exact' });
  if (error) throw error;
  return { inserted: count ?? rows.length };
}

export type AttachmentProgress = {
  total: number;
  uploaded: number;
  mandatoryTotal: number;
  mandatoryMissing: number;
  blockers: AttachmentBlocker[];
};

/** Pure helper — DB rows → progress / blockers (testable). */
export function computeAttachmentProgress(
  rows: Array<{
    attachment_key?: string | null;
    name?: string | null;
    description?: string | null;
    is_mandatory?: boolean | null;
    file_url?: string | null;
    category?: string | null;
  }>,
): AttachmentProgress {
  const total = rows.length;
  const uploaded = rows.filter((r) => !!r.file_url).length;
  const mandatory = rows.filter((r) => !!r.is_mandatory);
  const blockers = mandatory
    .filter((r) => !r.file_url)
    .map((r) => ({
      key: r.attachment_key || '',
      name: r.name || r.attachment_key || '첨부',
      hint:
        r.description ||
        (r.category === 'legal'
          ? '법정 필수 첨부입니다. 업로드 후 결재를 상신하세요.'
          : '필수 첨부입니다. 업로드 후 결재를 상신하세요.'),
    }));
  return {
    total,
    uploaded,
    mandatoryTotal: mandatory.length,
    mandatoryMissing: blockers.length,
    blockers,
  };
}

/**
 * 결재 차단 검증 — work_plan_attachments.is_mandatory && !file_url (SSOT).
 * 템플릿 sync 전이면 legal 템플릿으로 fallback.
 */
export async function getApprovalBlockers(workPlanId: string, workType: string): Promise<AttachmentBlocker[]> {
  const { data } = await supabase
    .from('work_plan_attachments')
    .select('attachment_key, name, description, is_mandatory, file_url, category')
    .eq('work_plan_id', workPlanId)
    .eq('is_deleted', false);

  const rows = (data ?? []) as any[];
  if (rows.length > 0) {
    return computeAttachmentProgress(rows).blockers;
  }

  // Rows not synced yet — template fallback (legal required)
  const required = getMandatoryLegalAttachments(workType);
  return required.map((r) => ({
    key: r.key,
    name: r.name,
    hint: r.description || '필수 첨부입니다. 업로드 후 결재를 상신하세요.',
  }));
}

export async function getAttachmentProgress(workPlanId: string): Promise<AttachmentProgress> {
  const { data } = await supabase
    .from('work_plan_attachments')
    .select('attachment_key, name, description, is_mandatory, file_url, category')
    .eq('work_plan_id', workPlanId)
    .eq('is_deleted', false);
  return computeAttachmentProgress((data ?? []) as any[]);
}

/** Clone uploaded file refs onto a new plan (after syncTemplateRows). */
export async function cloneAttachmentFiles(opts: {
  fromPlanId: string;
  toPlanId: string;
  projectId: string;
  companyId?: string | null;
  workType: string;
}) {
  await syncTemplateRows({
    workPlanId: opts.toPlanId,
    projectId: opts.projectId,
    companyId: opts.companyId,
    workType: opts.workType,
  });
  const { data: src } = await supabase
    .from('work_plan_attachments')
    .select('attachment_key, file_url, file_path, file_size, mime_type')
    .eq('work_plan_id', opts.fromPlanId)
    .eq('is_deleted', false)
    .not('file_url', 'is', null);
  for (const row of (src ?? []) as any[]) {
    if (!row.attachment_key || !row.file_url) continue;
    await supabase
      .from('work_plan_attachments')
      .update({
        file_url: row.file_url,
        file_path: row.file_path,
        file_size: row.file_size,
        mime_type: row.mime_type,
      })
      .eq('work_plan_id', opts.toPlanId)
      .eq('attachment_key', row.attachment_key)
      .eq('is_deleted', false);
  }
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

/* ============================================================
 * RA(위험성평가) → WP(작업계획서) 자동 연계
 * ============================================================ */

export interface LatestApprovedRun {
  id: string;
  period_label: string;
  start_date: string | null;
  end_date: string | null;
  approved_at?: string | null;
}

/** 프로젝트의 최신 승인완료 위험성평가 회차 1건 조회 */
export async function fetchLatestApprovedRun(projectId: string): Promise<LatestApprovedRun | null> {
  const { data } = await supabase
    .from('assessment_runs')
    .select('id, period_label, start_date, end_date, updated_at, status, is_deleted')
    .eq('project_id', projectId)
    .eq('is_deleted', false)
    .in('status', ['approved', '승인완료', '승인'])
    .order('updated_at', { ascending: false })
    .limit(1);
  const r = (data || [])[0] as any;
  if (!r) return null;
  return {
    id: r.id,
    period_label: r.period_label,
    start_date: r.start_date,
    end_date: r.end_date,
    approved_at: r.updated_at,
  };
}

/** 위험도 상(High) 항목의 hazard/improvement_measure 를 작업계획서 sections 배열에 upsert.
 *  기존 사용자 편집 항목(manually_edited=true)은 보존한다.
 */
export async function syncRaToWp(opts: {
  runId: string;
  workPlanId: string;
  existingSections: any[];
}): Promise<{ imported: number; sections: any[] }> {
  const { data: items } = await supabase
    .from('risk_items')
    .select('id, process, sub_task, hazard, improvement_measure, risk_grade')
    .eq('run_id', opts.runId)
    .eq('is_deleted', false);

  const high = (items || []).filter((x: any) =>
    ['상', 'high', 'H', '3'].includes(String(x.risk_grade || '').trim())
  );

  const sections = [...(opts.existingSections || [])];
  const idx = sections.findIndex((s: any) => s.key === '_ra_high_risks');
  const bulletLines = high.map((h: any) =>
    `• [${h.process || '-'} / ${h.sub_task || '-'}] ${h.hazard || ''}\n   → ${h.improvement_measure || ''}`
  ).join('\n');
  const content = high.length === 0
    ? '(연결된 위험성평가 회차에 위험도 상 항목이 없습니다.)'
    : bulletLines;

  const entry = {
    key: '_ra_high_risks',
    title: '위험성평가 연계 — 위험도 상 항목 및 대책',
    type: 'text',
    content,
    source_run_id: opts.runId,
    synced_at: new Date().toISOString(),
  };
  if (idx >= 0) {
    // 사용자가 수기 편집한 흔적 보존
    const prev: any = sections[idx];
    if (prev.manually_edited) {
      return { imported: 0, sections };
    }
    sections[idx] = { ...prev, ...entry };
  } else {
    sections.push(entry);
  }

  await supabase.from('work_plans').update({ sections, updated_at: new Date().toISOString() })
    .eq('id', opts.workPlanId);

  return { imported: high.length, sections };
}
