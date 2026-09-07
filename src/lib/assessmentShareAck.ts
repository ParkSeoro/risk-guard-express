/**
 * Company-scoped RA result sharing after approval.
 * One handwritten confirmation per person per run → 근로자 참여 및 공유 서명.
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizeCompanyIds } from "@/lib/weeklyAssessmentLink";

function todaySeoulDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

export type ShareAckRun = {
  id: string;
  project_id: string;
  type?: string | null;
  status: string;
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string | null;
  target_company_ids?: string[] | null;
  author_company_id?: string | null;
  period_label?: string | null;
  is_deleted?: boolean | null;
};

export type PendingAssessmentShare = {
  run_id: string;
  project_id: string;
  period_label: string;
  type: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  summary: string;
  notice_id: string | null;
};

export type AssessmentShareAck = {
  id: string;
  run_id: string;
  worker_name: string | null;
  company_name: string | null;
  signature_data: string | null;
  signed_at: string;
  source: string | null;
};

/** Prefer explicit targets; empty means unknown, not the whole site. */
export function runAppliesToCompany(
  run: { target_company_ids?: string[] | null; author_company_id?: string | null },
  companyId?: string | null,
): boolean {
  const targets = normalizeCompanyIds(run.target_company_ids);
  const effective = targets.length > 0 ? targets : normalizeCompanyIds(run.author_company_id ? [run.author_company_id] : []);
  if (effective.length === 0) return false;
  const id = String(companyId || "").trim();
  if (!id) return false;
  return effective.includes(id);
}

export function runCoversDate(
  run: { start_date?: string | null; end_date?: string | null },
  day: string,
): boolean {
  const start = String(run.start_date || "").trim().slice(0, 10);
  const end = String(run.end_date || "").trim().slice(0, 10);
  if (start && day < start) return false;
  if (end && day > end) return false;
  return true;
}

function periodSortKey(run: ShareAckRun): string {
  return (
    String(run.start_date || "").trim().slice(0, 10) ||
    String(run.created_at || "") ||
    ""
  );
}

/** Approved runs that apply to this company on this Seoul calendar day. */
export function pickCompanyPeriodRuns(
  runs: ShareAckRun[],
  companyId: string | null | undefined,
  day: string,
): ShareAckRun[] {
  const live = (runs || []).filter(
    (r) => r && r.id && r.status === "승인완료" && !r.is_deleted && runAppliesToCompany(r, companyId),
  );
  const covering = live.filter((r) => runCoversDate(r, day));
  if (covering.length > 0) return covering;
  const ranked = live.slice().sort((a, b) => {
    const ak = periodSortKey(a);
    const bk = periodSortKey(b);
    if (ak !== bk) return ak < bk ? 1 : -1;
    return String(a.created_at || "") < String(b.created_at || "") ? 1 : -1;
  });
  return ranked[0] ? [ranked[0]] : [];
}

export function isSafeSignatureDataUrl(raw: string | null | undefined): boolean {
  const s = String(raw || "").trim();
  return /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(s);
}

export function pairShareAcks<T>(acks: T[]): Array<[T | null, T | null]> {
  const pairs: Array<[T | null, T | null]> = [];
  for (let i = 0; i < acks.length; i += 2) {
    pairs.push([acks[i] || null, acks[i + 1] || null]);
  }
  return pairs;
}

/** Keep at least this many signature rows (2 names per row) for paper overflow. */
export function shareSignatureRowCount(ackCount: number, minRows = 8): number {
  const filled = Math.ceil(Math.max(0, ackCount) / 2);
  return Math.max(minRows, filled);
}

export async function fetchCompanyPeriodRunIds(
  projectId: string,
  companyId: string | null | undefined,
  day = todaySeoulDate(),
): Promise<string[]> {
  if (!companyId) return [];
  const { data, error } = await supabase.rpc("list_company_period_assessment_run_ids", {
    _project_id: projectId,
    _company_id: companyId,
    _day: day,
  });
  if (!error && Array.isArray(data)) {
    return (data as string[]).filter(Boolean);
  }
  const { data: rows } = await supabase
    .from("assessment_runs")
    .select("id, project_id, type, status, start_date, end_date, created_at, target_company_ids, period_label, is_deleted")
    .eq("project_id", projectId)
    .eq("status", "승인완료")
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(40);
  return pickCompanyPeriodRuns((rows || []) as ShareAckRun[], companyId, day).map((r) => r.id);
}

export async function listPendingAssessmentShares(
  projectId?: string | null,
): Promise<PendingAssessmentShare[]> {
  const { data, error } = await supabase.rpc("list_my_pending_assessment_shares", {
    _project_id: projectId || null,
  });
  if (error) return [];
  return (data || []) as PendingAssessmentShare[];
}

export async function ackAssessmentRunShare(opts: {
  runId: string;
  signatureData: string;
  workerId?: string | null;
  source?: "notice" | "daily_ack" | "viewer";
}): Promise<{ ok: boolean; already?: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("ack_assessment_run_share", {
    _run_id: opts.runId,
    _signature_data: opts.signatureData,
    _worker_id: opts.workerId || null,
    _source: opts.source || "notice",
  });
  if (error) return { ok: false, error: error.message };
  const row = (data || {}) as { ok?: boolean; already?: boolean; error?: string };
  if (row.error) return { ok: false, error: row.error };
  return { ok: row.ok !== false, already: !!row.already };
}

export async function stampPendingSharesFromDailyAck(opts: {
  projectId: string;
  workerId: string;
  signatureData: string;
  runIds: string[];
}): Promise<void> {
  const ids = [...new Set(opts.runIds.filter(Boolean))];
  for (const runId of ids) {
    await ackAssessmentRunShare({
      runId,
      signatureData: opts.signatureData,
      workerId: opts.workerId,
      source: "daily_ack",
    });
  }
}

export async function fetchAssessmentShareAcks(runId: string): Promise<AssessmentShareAck[]> {
  const { data, error } = await supabase
    .from("assessment_run_share_acks" as any)
    .select("id, run_id, worker_name, company_name, signature_data, signed_at, source")
    .eq("run_id", runId)
    .order("signed_at", { ascending: true });
  if (error) return [];
  return (data || []) as AssessmentShareAck[];
}
