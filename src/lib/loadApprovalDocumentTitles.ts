import { supabase } from "@/integrations/supabase/client";
import { approvalTitleKey, formatApprovalDocumentTitle } from "@/lib/approvalDocumentTitle";

const TITLE_SOURCES: Record<string, { table: string; columns: string }> = {
  work_plan: { table: "work_plans", columns: "id, title" },
  work_permit: { table: "work_permits", columns: "id, work_name, work_description" },
  safety_inspection: {
    table: "safety_inspections",
    columns: "id, inspection_type, process_category, location",
  },
  safety_cost: { table: "safety_cost_monthly_reports", columns: "id, title, report_month" },
  tbm: { table: "tbm_sessions", columns: "id, title, tbm_date, location" },
  emergency_drill: { table: "emergency_drills", columns: "id, title, location" },
  incident: { table: "incident_reports", columns: "id, incident_type, location" },
};

const CHUNK = 80;

export function approvalEntityIdsByType(
  rows: Array<{ entity_type?: string | null; entity_id?: string | null }>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const row of rows) {
    const type = String(row.entity_type || "");
    const id = String(row.entity_id || "");
    if (!type || !id || !TITLE_SOURCES[type]) continue;
    const list = out[type] || [];
    if (!list.includes(id)) list.push(id);
    out[type] = list;
  }
  return out;
}

async function selectChunk(table: string, columns: string, ids: string[]) {
  const { data, error } = await (supabase.from(table as "work_plans") as any).select(columns).in("id", ids);
  if (error) throw error;
  return (data || []) as Array<{ id: string } & Record<string, unknown>>;
}

/** 결재 행에 없는 문서 이름을 종류별로 한 번씩 읽는다. 실패한 종류는 빠진다. */
export async function loadApprovalDocumentTitles(
  rows: Array<{ entity_type?: string | null; entity_id?: string | null }>,
): Promise<Record<string, string>> {
  const byType = approvalEntityIdsByType(rows);
  const titles: Record<string, string> = {};
  await Promise.all(
    Object.entries(byType).map(async ([type, ids]) => {
      const source = TITLE_SOURCES[type];
      if (!source || ids.length === 0) return;
      try {
        for (let i = 0; i < ids.length; i += CHUNK) {
          const slice = ids.slice(i, i + CHUNK);
          const found = await selectChunk(source.table, source.columns, slice);
          for (const row of found) {
            const title = formatApprovalDocumentTitle(type, row);
            if (title) titles[approvalTitleKey(type, row.id)] = title;
          }
        }
      } catch {
        // 이 종류 제목만 비운다. 결재 목록 자체는 그대로 보여 준다.
      }
    }),
  );
  return titles;
}
