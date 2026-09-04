/**
 * Align work_permit_workers to tbm_participations for a linked TBM.
 * Kept for scripts; the permit detail UI no longer overwrites expected crew from TBM.
 */
import { supabase } from "@/integrations/supabase/client";
import { buildPersonnelCountPatch } from "@/lib/permitWorkers";
import { EMPTY_TBM_CREW_GUARD, shouldRefuseEmptyCrewReplace } from "@/lib/permitCrewPolicy";

export { EMPTY_TBM_CREW_GUARD } from "@/lib/permitCrewPolicy";

export async function syncPermitCrewFromTbm(opts: {
  permitId: string;
  projectId: string;
  tbmSessionId: string;
  formData?: Record<string, unknown> | null;
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { data: parts, error: perr } = await supabase
    .from("tbm_participations" as any)
    .select("worker_id, worker_phone, worker_name")
    .eq("tbm_session_id", opts.tbmSessionId);
  if (perr) return { ok: false, error: perr.message };

  const rows = (parts as any[]) || [];
  const directIds = [
    ...new Set(rows.map((r) => r.worker_id).filter(Boolean) as string[]),
  ];

  // Resolve phone-only participants → workers in this project scope
  const phones = [
    ...new Set(
      rows
        .filter((r) => !r.worker_id && r.worker_phone)
        .map((r) => String(r.worker_phone).replace(/\D/g, ""))
        .filter((p) => p.length >= 10),
    ),
  ];

  const resolvedIds = new Set<string>(directIds);
  if (phones.length > 0) {
    const { data: byPhone, error: werr } = await supabase
      .from("workers")
      .select("id, phone")
      .eq("project_id", opts.projectId);
    if (werr) return { ok: false, error: werr.message };
    const phoneSet = new Set(phones);
    for (const w of (byPhone as any[]) || []) {
      const digits = String(w.phone || "").replace(/\D/g, "");
      if (digits && phoneSet.has(digits)) resolvedIds.add(w.id);
    }
  }

  const ids = [...resolvedIds];
  if (shouldRefuseEmptyCrewReplace(ids.length)) {
    return { ok: false, error: EMPTY_TBM_CREW_GUARD };
  }

  const { data: permit, error: permitErr } = await supabase
    .from("work_permits" as any)
    .select("id, form_data")
    .eq("id", opts.permitId)
    .maybeSingle();
  if (permitErr || !permit) {
    return { ok: false, error: permitErr?.message || "허가서를 찾을 수 없습니다." };
  }

  const { error: delErr } = await supabase
    .from("work_permit_workers" as any)
    .delete()
    .eq("work_permit_id", opts.permitId);
  if (delErr) return { ok: false, error: delErr.message };

  const insertRows = ids.map((worker_id) => ({
    work_permit_id: opts.permitId,
    worker_id,
    project_id: opts.projectId,
    notification_status: "pending",
  }));
  const { error: insErr } = await supabase.from("work_permit_workers" as any).insert(insertRows);
  if (insErr) return { ok: false, error: insErr.message };

  const patch = buildPersonnelCountPatch(
    opts.formData ?? (permit as any).form_data,
    ids.length,
  );
  const { error: uerr } = await supabase
    .from("work_permits" as any)
    .update(patch as any)
    .eq("id", opts.permitId);
  if (uerr) return { ok: false, error: uerr.message };

  return { ok: true, count: ids.length };
}
