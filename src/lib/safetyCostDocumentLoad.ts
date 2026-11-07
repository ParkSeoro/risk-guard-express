import { supabase } from '@/integrations/supabase/client';
import { isClientType, resolveProjectCompanyType } from '@/lib/companyTypes';
import { fetchProjectCompanies } from '@/lib/projectCompanies';
import { sumSafetyCostByCategory } from '@/lib/safetyCost';
import type { SafetyCostDocFile, SafetyCostDocInput, SafetyCostSigner } from '@/lib/safetyCostDocumentBuilder';

const SIGN_SLOTS: Array<{ title: string; keys: string[] }> = [
  { title: '안전관리자', keys: ['contractor_safety_manager', 'contractor_supervisor', 'contractor_pic'] },
  { title: '안전보건관리책임자', keys: ['contractor_site_director', 'site_director'] },
  { title: '발주처/감리', keys: ['owner_sm', 'sm'] },
];

function statusLabel(status: string | null | undefined): string {
  if (status === 'approved') return '승인';
  if (status === 'rejected') return '반려';
  if (status === 'pending') return '대기';
  return status || '';
}

function formatWhen(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

function pickSigners(rows: any[]): SafetyCostSigner[] {
  const latestVersion = rows.reduce((max, row) => Math.max(max, Number(row.approval_version || 0)), 0);
  const pool = rows.filter((row) => Number(row.approval_version || 0) === latestVersion);
  return SIGN_SLOTS.map((slot) => {
    const hit = pool.find((row) => slot.keys.includes(String(row.position || row.step || '')));
    return {
      title: slot.title,
      name: hit?.approver_name || '',
      company: hit?.company_name || '',
      status: statusLabel(hit?.status),
      approvedAt: formatWhen(hit?.approved_at),
    };
  });
}

async function publicFileUrl(file: { file_url?: string | null; file_path?: string | null }): Promise<string> {
  const direct = String(file.file_url || '').trim();
  if (direct) return direct;
  const path = String(file.file_path || '').trim();
  if (!path) return '';
  const { data } = supabase.storage.from('attachments').getPublicUrl(path);
  return data?.publicUrl || '';
}

/** 사용내역서 한 건을 읽기만 한다. 허가서·위험성평가·TBM·결재 행은 쓰지 않는다. */
export async function loadSafetyCostDocument(
  reportId: string,
  opts?: { includeStock?: boolean },
): Promise<SafetyCostDocInput> {
  const db = supabase as any;
  const { data: report, error } = await db
    .from('safety_cost_monthly_reports')
    .select('*')
    .eq('id', reportId)
    .maybeSingle();
  if (error) throw error;
  if (!report) throw new Error('사용내역서를 찾을 수 없습니다.');
  const row = report as any;

  const { data: construction } = await db
    .from('safety_cost_constructions')
    .select('*')
    .eq('id', row.construction_id)
    .maybeSingle();
  const site = (construction || {}) as any;

  const [{ data: itemRows }, { data: fileRows }, companies, { data: approvalRows }] = await Promise.all([
    db.from('safety_cost_items').select('*').eq('report_id', reportId).eq('is_deleted', false).order('sort_order'),
    db.from('safety_cost_evidence_files').select('*').eq('report_id', reportId).order('created_at'),
    fetchProjectCompanies(row.project_id).catch(() => []),
    db
      .from('approvals')
      .select('position, step, approver_name, status, approved_at, step_order, approval_version, company_name')
      .eq('entity_type', 'safety_cost')
      .eq('entity_id', reportId),
  ]);

  const company = companies.find((c) => c.id === row.company_id);
  const clients = companies.filter((c: any) =>
    isClientType(resolveProjectCompanyType(c.role_in_project, c.type)),
  );
  const progress = row.cumulative_progress_rate ?? site.cumulative_progress_rate;
  const items = ((itemRows || []) as any[]).map((item) => ({
    id: item.id,
    category_code: item.category_code,
    category_name: item.category_name,
    amount: item.amount,
    supply_amount: item.supply_amount,
    vat_amount: item.vat_amount,
    item_name: item.item_name,
    supplier_name: item.supplier_name,
    specification: item.specification,
    quantity: item.quantity,
    unit: item.unit,
    unit_price: item.unit_price,
    transaction_date: item.transaction_date,
    usage_date: item.usage_date,
    is_deleted: item.is_deleted,
  }));

  const files: SafetyCostDocFile[] = await Promise.all(
    ((fileRows || []) as any[]).filter((file) => !file.is_deleted).map(async (file) => ({
      id: file.id,
      item_id: file.item_id,
      report_id: file.report_id,
      evidence_kind: file.evidence_kind || 'other',
      category_code: file.category_code || null,
      note: file.note || '',
      file_name: file.file_name || '',
      file_path: file.file_path || '',
      file_url: await publicFileUrl(file),
      mime_type: file.mime_type || '',
    })),
  );

  let priorByCategory: Record<string, number> = {};
  const month = String(row.report_month || '');
    const { data: siblings } = await db
    .from('safety_cost_monthly_reports')
    .select('id, report_month, status')
    .eq('construction_id', row.construction_id)
    .eq('is_deleted', false);
  const priorIds = ((siblings || []) as any[])
    .filter((r) => r.status === 'approved' && String(r.report_month || '') < month && r.id !== reportId)
    .map((r) => r.id);
  if (priorIds.length) {
    const { data: priorItems } = await db
      .from('safety_cost_items')
      .select('category_code, category_name, amount, is_deleted, report_id')
      .in('report_id', priorIds)
      .eq('is_deleted', false);
    priorByCategory = sumSafetyCostByCategory((priorItems || []) as any[]);
  }

  let ledger: SafetyCostDocInput['ledger'] = [];
  const { data: led } = await db
    .from('safety_cost_ppe_ledgers')
    .select('id')
    .eq('report_id', reportId)
    .eq('is_deleted', false)
    .maybeSingle();
  if (led?.id) {
    const { data: entries } = await db
      .from('safety_cost_ppe_ledger_entries')
      .select('item_name, worker_name, quantity, signature_data, signed_at')
      .eq('ledger_id', led.id)
      .eq('is_deleted', false);
    ledger = ((entries || []) as any[]).map((entry) => ({
      item_name: entry.item_name,
      worker_name: entry.worker_name,
      qty: entry.quantity,
      signature_data: entry.signature_data,
      signed_at: entry.signed_at,
    }));
  }

  let stock: SafetyCostDocInput['stock'] = [];
  if (opts?.includeStock && row.construction_id) {
    const { data: moves } = await db
      .from('safety_cost_ppe_stock_movements')
      .select('movement_type, quantity, movement_date, note, sku_id')
      .eq('construction_id', row.construction_id)
      .eq('is_deleted', false)
      .order('movement_date');
    const skuIds = [...new Set(((moves || []) as any[]).map((m) => m.sku_id).filter(Boolean))];
    const names = new Map<string, string>();
    if (skuIds.length) {
      const { data: skus } = await db
        .from('safety_cost_ppe_skus')
        .select('id, item_name')
        .in('id', skuIds);
      for (const sku of (skus || []) as any[]) names.set(sku.id, sku.item_name);
    }
    stock = ((moves || []) as any[]).map((move) => ({
      movement_type: move.movement_type,
      item_name: names.get(move.sku_id) || '',
      qty: move.quantity,
      movement_date: move.movement_date,
      note: move.note,
    }));
  }

  return {
    report: {
      id: row.id,
      year_month: month ? String(month).slice(0, 7) : '',
      status: row.status,
      source: row.source,
      cumulative_progress_rate: progress == null || progress === '' ? null : Number(progress),
      safety_cost_total: site.safety_cost_total ?? null,
      contract_amount: site.construction_amount ?? null,
      construction_name: site.construction_name || '',
    },
    companyName: company?.name || '',
    companyAddress: company?.address || '',
    clientName: clients.length === 1 ? clients[0].name : '',
    items,
    files,
    priorByCategory,
    ledger,
    stock,
    signers: pickSigners((approvalRows || []) as any[]),
  };
}
