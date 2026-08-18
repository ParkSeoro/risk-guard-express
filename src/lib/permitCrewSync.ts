/**
 * Sync work_permit_workers to today's on-site (checked-in) workers
 * scoped to the permit's company (never mix peer contractors).
 *
 * Policy:
 * - Early day: expected assignment on the permit is SSOT → keep TBM aligned via syncPermitCrewToTbm.
 * - When real check-ins exist: this replace is safe.
 * - Never wipe an existing crew when on-site (or company-scoped) count is 0.
 */
import { supabase } from "@/integrations/supabase/client";
import { buildPersonnelCountPatch, filterPermitAssignableWorkers } from "@/lib/permitWorkers";
import { seoulDayRange, todaySeoulDate } from "@/lib/dailyWorkAck";
import {
  EMPTY_ONSITE_CREW_GUARD,
  EMPTY_SCOPED_ONSITE_GUARD,
  shouldRefuseEmptyCrewReplace,
} from "@/lib/permitCrewPolicy";

export {
  EMPTY_ONSITE_CREW_GUARD,
  EMPTY_SCOPED_ONSITE_GUARD,
  shouldRefuseEmptyCrewReplace,
} from "@/lib/permitCrewPolicy";

export async function syncPermitCrewFromOnSite(opts: {
  permitId: string;
  projectId: string;
  formData?: Record<string, unknown> | null;
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const dayRange = seoulDayRange(todaySeoulDate());

  const { data: permit, error: perr } = await supabase
    .from("work_permits" as any)
    .select("id, company_id, contractor_company, form_data")
    .eq("id", opts.permitId)
    .maybeSingle();
  if (perr || !permit) return { ok: false, error: perr?.message || "허가서를 찾을 수 없습니다." };

  const companyId = (permit as any).company_id as string | null;
  if (!companyId) {
    return { ok: false, error: "허가서에 소속 회사가 없어 출근자를 반영할 수 없습니다." };
  }

  let companyName: string | null =
    ((permit as any).form_data || {}).contractor_company ||
    (permit as any).contractor_company ||
    null;
  if (!companyName) {
    const { data: cRow } = await supabase
      .from("companies")
      .select("name")
      .eq("id", companyId)
      .maybeSingle();
    companyName = (cRow as any)?.name || null;
  }

  const { data: logs, error: lerr } = await supabase
    .from("worker_entry_logs" as any)
    .select("worker_id, exit_at, entry_at")
    .eq("project_id", opts.projectId)
    .gte("entry_at", dayRange.start)
    .lte("entry_at", dayRange.end);
  if (lerr) return { ok: false, error: lerr.message };

  const onSiteSet = new Set<string>();
  for (const row of (logs as any[]) || []) {
    if (row.worker_id && !row.exit_at) onSiteSet.add(row.worker_id);
  }
  const candidateIds = [...onSiteSet];
  if (shouldRefuseEmptyCrewReplace(candidateIds.length)) {
    return { ok: false, error: EMPTY_ONSITE_CREW_GUARD };
  }

  const workers: any[] = [];
  for (let i = 0; i < candidateIds.length; i += 100) {
    const chunk = candidateIds.slice(i, i + 100);
    const { data: ws, error: werr } = await supabase
      .from("workers")
      .select("id, company_id, company_name")
      .in("id", chunk);
    if (werr) return { ok: false, error: werr.message };
    workers.push(...((ws as any[]) || []));
  }

  const scoped = filterPermitAssignableWorkers(workers, companyId, companyName);
  const ids = scoped.map((w) => w.id);
  if (shouldRefuseEmptyCrewReplace(ids.length)) {
    return { ok: false, error: EMPTY_SCOPED_ONSITE_GUARD };
  }

  const { error: delErr } = await supabase
    .from("work_permit_workers" as any)
    .delete()
    .eq("work_permit_id", opts.permitId);
  if (delErr) return { ok: false, error: delErr.message };

  const rows = ids.map((worker_id) => ({
    work_permit_id: opts.permitId,
    worker_id,
    project_id: opts.projectId,
    notification_status: "pending",
  }));
  const { error: insErr } = await supabase.from("work_permit_workers" as any).insert(rows);
  if (insErr) return { ok: false, error: insErr.message };

  const patch = buildPersonnelCountPatch(opts.formData ?? (permit as any).form_data, ids.length);
  const { error: uerr } = await supabase
    .from("work_permits" as any)
    .update(patch as any)
    .eq("id", opts.permitId);
  if (uerr) return { ok: false, error: uerr.message };

  return { ok: true, count: ids.length };
}
