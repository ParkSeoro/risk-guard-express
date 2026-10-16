import { supabase } from "@/integrations/supabase/client";

export type AssessmentRunItemStats = {
  total: number;
  high: number;
  med: number;
  low: number;
  residual: number;
};

export type AssessmentRunItemStatsRow = {
  run_id: string;
  total: number | null;
  high: number | null;
  med: number | null;
  low: number | null;
  residual: number | null;
};

const EMPTY: AssessmentRunItemStats = { total: 0, high: 0, med: 0, low: 0, residual: 0 };

export function emptyAssessmentRunItemStats(): AssessmentRunItemStats {
  return { ...EMPTY };
}

/** Map RPC rows → run_id keyed stats (missing runs stay 0). */
export function mapAssessmentRunItemStats(
  runIds: string[],
  rows: AssessmentRunItemStatsRow[] | null | undefined,
): Record<string, AssessmentRunItemStats> {
  const out: Record<string, AssessmentRunItemStats> = {};
  for (const id of runIds) out[id] = emptyAssessmentRunItemStats();
  for (const row of rows || []) {
    if (!row?.run_id || !(row.run_id in out)) continue;
    out[row.run_id] = {
      total: Number(row.total) || 0,
      high: Number(row.high) || 0,
      med: Number(row.med) || 0,
      low: Number(row.low) || 0,
      residual: Number(row.residual) || 0,
    };
  }
  return out;
}

export async function fetchAssessmentRunItemStats(
  runIds: string[],
): Promise<Record<string, AssessmentRunItemStats>> {
  const ids = [...new Set(runIds.map(String).filter(Boolean))];
  if (ids.length === 0) return {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("assessment_run_item_stats", {
    _run_ids: ids,
  });

  if (error) throw error;
  return mapAssessmentRunItemStats(ids, (data || []) as AssessmentRunItemStatsRow[]);
}
