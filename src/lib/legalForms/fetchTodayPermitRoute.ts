/**
 * 당일 허가서·출역·TBM으로 순회일지 머리글(구간·작업내용·출력현황·날씨)을 채운다.
 * 법제처 호출 없음.
 */
import { supabase } from '@/integrations/supabase/client';
import { seoulDayRange } from '@/lib/dailyWorkAck';
import {
  TODAY_PATROL_PERMIT_STATUSES,
  collectTodayPermitRoute,
  collectTodayPermitWorks,
  pickPatrolPrintStamps,
  weatherLabelFromSnapshots,
  type PatrolManpowerRow,
  type PatrolPrintStamps,
  type PermitRouteRow,
} from '@/lib/legalForms/patrolLog';
import { resolvePermitWorkDate, todayKst } from '@/lib/permitWorkDate';
import { buildAssessmentSignatureRows } from '@/lib/approvalSignatureRows';
import { fetchDocumentApprovalDraft } from '@/lib/approvalPlatform/draftClient';

export async function fetchTodayPermitRoute(projectId: string, day?: string): Promise<string> {
  if (!projectId) return '';
  const { data, error } = await supabase
    .from('work_permits' as any)
    .select('location, work_name, work_description, status, is_deleted, permit_date, work_start_at, form_data')
    .eq('project_id', projectId)
    .eq('is_deleted', false)
    .limit(200);
  if (error) return '';
  return collectTodayPermitRoute(((data as PermitRouteRow[]) || []), day);
}

export type PatrolPrintContext = {
  route: string;
  works: string[];
  weather: string;
  manpower: PatrolManpowerRow[];
  tbmAttendees: number;
  tbmRate: string;
};

export async function fetchPatrolPrintContext(
  projectId: string,
  day?: string,
  companyId?: string | null,
): Promise<PatrolPrintContext> {
  const empty: PatrolPrintContext = {
    route: '',
    works: [],
    weather: '',
    manpower: [],
    tbmAttendees: 0,
    tbmRate: '',
  };
  if (!projectId) return empty;

  let permitQ = supabase
    .from('work_permits' as any)
    .select('location, work_name, work_description, status, is_deleted, permit_date, work_start_at, form_data, weather_snapshot, contractor_company, personnel_count, company_id')
    .eq('project_id', projectId)
    .eq('is_deleted', false)
    .limit(200);
  if (companyId) permitQ = permitQ.eq('company_id', companyId);
  const { data: permits, error } = await permitQ;
  if (error) return empty;
  const rows = (permits as PermitRouteRow[]) || [];
  const route = collectTodayPermitRoute(rows, day);
  let works = collectTodayPermitWorks(rows, day);
  if (!works.length && companyId) {
    const { data: allPermits } = await supabase
      .from('work_permits' as any)
      .select('location, work_name, work_description, status, is_deleted, permit_date, work_start_at, form_data, weather_snapshot, contractor_company, personnel_count, company_id')
      .eq('project_id', projectId)
      .eq('is_deleted', false)
      .limit(200);
    works = collectTodayPermitWorks(((allPermits as PermitRouteRow[]) || []), day);
  }
  const snaps = rows.map((p) => (p as { weather_snapshot?: unknown }).weather_snapshot).filter(Boolean);
  const weather = weatherLabelFromSnapshots(snaps);

  let manpower: PatrolManpowerRow[] = [];
  let tbmAttendees = 0;
  let tbmRate = '';
  try {
    if (day) {
      const range = seoulDayRange(day);
      const { data: logs } = await supabase
        .from('worker_entry_logs')
        .select('worker_id')
        .eq('project_id', projectId)
        .gte('entry_at', range.start)
        .lte('entry_at', range.end)
        .limit(2000);
      const ids = Array.from(new Set(((logs as { worker_id?: string }[]) || []).map((l) => l.worker_id).filter(Boolean))) as string[];
      if (ids.length) {
        let wq = supabase.from('workers').select('id, company_name, company_id').in('id', ids);
        if (companyId) wq = wq.eq('company_id', companyId);
        const { data: workers } = await wq;
        const counts = new Map<string, number>();
        for (const w of (workers as { company_name?: string }[]) || []) {
          const name = String(w.company_name || '미지정').trim() || '미지정';
          counts.set(name, (counts.get(name) || 0) + 1);
        }
        manpower = Array.from(counts.entries()).map(([title, today], i) => ({
          group: i === 0 ? '당 사' : '시 공 사',
          title,
          today,
        }));
      }
      let tbmQ = supabase
        .from('tbm_sessions')
        .select('id')
        .eq('project_id', projectId)
        .eq('tbm_date', day)
        .eq('is_deleted', false);
      if (companyId) tbmQ = tbmQ.eq('company_id', companyId);
      const { data: sessions } = await tbmQ;
      const sessionIds = ((sessions as { id: string }[]) || []).map((s) => s.id);
      if (sessionIds.length) {
        const { count } = await supabase
          .from('tbm_participations')
          .select('id', { count: 'exact', head: true })
          .in('tbm_session_id', sessionIds);
        tbmAttendees = count || 0;
        const headcount = manpower.reduce((n, r) => n + Number(r.today || 0), 0);
        tbmRate = headcount > 0 ? `${Math.round((tbmAttendees / headcount) * 100)}%` : '';
      }
    }
  } catch {
    /* print header stays empty rather than failing the log */
  }

  if (!manpower.length) {
    const onDay = day || todayKst();
    const byCo = new Map<string, number>();
    for (const p of rows) {
      if (!TODAY_PATROL_PERMIT_STATUSES.has(String(p.status || ''))) continue;
      if (resolvePermitWorkDate(p) !== onDay) continue;
      const name = String(p.contractor_company || '').trim();
      if (!name) continue;
      byCo.set(name, (byCo.get(name) || 0) + Number(p.personnel_count || 0));
    }
    manpower = Array.from(byCo.entries()).map(([title, todayCount], i) => ({
      group: i === 0 ? '당 사' : '시 공 사',
      title,
      today: todayCount || '',
    }));
  }

  return { route, works, weather, manpower, tbmAttendees, tbmRate };
}

export async function fetchPatrolPrintStamps(entityId: string): Promise<PatrolPrintStamps> {
  const empty: PatrolPrintStamps = { sm: null, director: null };
  if (!entityId) return empty;
  const { data: approvals } = await supabase
    .from('approvals')
    .select('step, step_order, position, approver_name, status, approved_at, approval_version')
    .eq('entity_type', 'safety_inspection')
    .eq('entity_id', entityId)
    .neq('status', '취소');
  let rows = buildAssessmentSignatureRows({ approvals: approvals || [] });
  if (rows.length === 0) {
    const draft = await fetchDocumentApprovalDraft('safety_inspection', entityId);
    rows = buildAssessmentSignatureRows({ draftSteps: draft?.steps || [] });
  }
  return pickPatrolPrintStamps(rows.map((r) => ({
    step: r.step,
    position: r.position,
    approver_name: r.approver_name,
    status: r.status,
    approved_at: r.approved_at,
  })));
}
