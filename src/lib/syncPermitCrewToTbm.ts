/**
 * Keep tbm_participations aligned with work_permit_workers for a linked TBM.
 * - Adds missing crew as unsigned participants
 * - Removes unsigned participants no longer on the crew (keeps signed rows)
 * - Skips workers with no phone (unique on tbm_session_id, worker_phone)
 */
import { supabase } from "@/integrations/supabase/client";

export function phoneDigits(phone?: string | null): string {
  return String(phone || "").replace(/\D/g, "");
}

export function selectTbmCrewInserts<
  T extends { id: string; name?: string | null; phone?: string | null; company_name?: string | null },
>(
  crew: T[],
  existing: Array<{ worker_id?: string | null; worker_phone?: string | null }>,
): T[] {
  const byPhone = new Set(existing.map((p) => phoneDigits(p.worker_phone)).filter(Boolean));
  const byWorkerId = new Set(existing.map((p) => p.worker_id).filter(Boolean));
  const seen = new Set(byPhone);
  const out: T[] = [];
  for (const w of crew) {
    const digits = phoneDigits(w.phone);
    if (!digits) continue;
    if (byWorkerId.has(w.id)) continue;
    if (seen.has(digits)) continue;
    seen.add(digits);
    out.push(w);
  }
  return out;
}

export async function syncPermitCrewToTbm(opts: {
  permitId: string;
  tbmSessionId: string;
}): Promise<{ ok: true; added: number; removed: number } | { ok: false; error: string }> {
  const { data: links, error: lerr } = await supabase
    .from("work_permit_workers" as any)
    .select("worker_id")
    .eq("work_permit_id", opts.permitId);
  if (lerr) return { ok: false, error: lerr.message };

  const workerIds = [...new Set(((links as any[]) || []).map((r) => r.worker_id).filter(Boolean))];
  let crew: Array<{
    id: string;
    name: string;
    phone: string | null;
    company_name: string | null;
  }> = [];

  if (workerIds.length > 0) {
    const CHUNK = 50;
    for (let i = 0; i < workerIds.length; i += CHUNK) {
      const slice = workerIds.slice(i, i + CHUNK);
      const { data: ws, error: werr } = await supabase
        .from("workers")
        .select("id, name, phone, company_name")
        .in("id", slice);
      if (werr) return { ok: false, error: werr.message };
      crew.push(...(((ws as any[]) || []) as typeof crew));
    }
  }

  const { data: existing, error: eerr } = await supabase
    .from("tbm_participations" as any)
    .select("id, worker_id, worker_phone, signature_data")
    .eq("tbm_session_id", opts.tbmSessionId);
  if (eerr) return { ok: false, error: eerr.message };

  const parts = (existing as any[]) || [];
  const toAdd = selectTbmCrewInserts(crew, parts);

  let added = 0;
  if (toAdd.length > 0) {
    const rows = toAdd.map((w) => ({
      tbm_session_id: opts.tbmSessionId,
      worker_id: w.id,
      worker_name: w.name || "-",
      worker_phone: w.phone || "",
      company_name: w.company_name || "",
      briefing_confirmed: false,
      signature_data: "",
    }));
    const { error: ierr } = await supabase.from("tbm_participations" as any).insert(rows);
    if (ierr) return { ok: false, error: ierr.message };
    added = rows.length;
  }

  const crewIdSet = new Set(crew.map((w) => w.id));
  const crewPhoneSet = new Set(
    crew.map((w) => String(w.phone || "").replace(/\D/g, "")).filter(Boolean),
  );
  const removable = parts.filter((p) => {
    const signed = String(p.signature_data || "").length > 10;
    if (signed) return false;
    if (p.worker_id && crewIdSet.has(p.worker_id)) return false;
    const digits = String(p.worker_phone || "").replace(/\D/g, "");
    if (digits && crewPhoneSet.has(digits)) return false;
    return crew.length > 0;
  });

  let removed = 0;
  if (removable.length > 0) {
    const ids = removable.map((p) => p.id);
    const { error: derr } = await supabase
      .from("tbm_participations" as any)
      .delete()
      .in("id", ids);
    if (derr) return { ok: false, error: derr.message };
    removed = ids.length;
  }

  return { ok: true, added, removed };
}
