/**
 * Sync work_permit_workers to today's on-site (checked-in) workers.
 */
import { supabase } from "@/integrations/supabase/client";
import { buildPersonnelCountPatch } from "@/lib/permitWorkers";
import { todaySeoulDate } from "@/lib/dailyWorkAck";

export async function syncPermitCrewFromOnSite(opts: {
  permitId: string;
  projectId: string;
  formData?: Record<string, unknown> | null;
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const day = todaySeoulDate();
  const { data: logs, error: lerr } = await supabase
    .from("worker_entry_logs" as any)
    .select("worker_id, exit_at, entry_at")
    .eq("project_id", opts.projectId)
    .gte("entry_at", `${day}T00:00:00`)
    .lte("entry_at", `${day}T23:59:59.999`);
  if (lerr) return { ok: false, error: lerr.message };

  const onSite = new Set<string>();
  for (const row of (logs as any[]) || []) {
    if (row.worker_id && !row.exit_at) onSite.add(row.worker_id);
  }
  const ids = [...onSite];

  const { error: delErr } = await supabase
    .from("work_permit_workers" as any)
    .delete()
    .eq("work_permit_id", opts.permitId);
  if (delErr) return { ok: false, error: delErr.message };

  if (ids.length > 0) {
    const rows = ids.map((worker_id) => ({
      work_permit_id: opts.permitId,
      worker_id,
      project_id: opts.projectId,
      notification_status: "pending",
    }));
    const { error: insErr } = await supabase.from("work_permit_workers" as any).insert(rows);
    if (insErr) return { ok: false, error: insErr.message };
  }

  const patch = buildPersonnelCountPatch(opts.formData, ids.length);
  const { error: uerr } = await supabase
    .from("work_permits" as any)
    .update(patch as any)
    .eq("id", opts.permitId);
  if (uerr) return { ok: false, error: uerr.message };

  return { ok: true, count: ids.length };
}
