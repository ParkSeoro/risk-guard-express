/**
 * TBM session lifecycle: expire past-date sessions, auto-create on permit issue.
 */
import { supabase } from "@/integrations/supabase/client";
import { todayKst } from "@/lib/permitWorkDate";
import { ensureTbmForPermit, type TbmFromPermitResult } from "@/lib/tbmFromPermit";

/** Close TBM sessions whose tbm_date is before today (KST). Returns closed count. */
export async function closeExpiredTbmSessions(
  projectId?: string | null,
): Promise<{ ok: true; closed: number } | { ok: false; error: string }> {
  // Prefer SECURITY DEFINER RPC (bypasses RLS fan-out limits) when available.
  try {
    const { data: rpcCount, error: rpcErr } = await supabase.rpc("close_expired_tbm_sessions");
    if (!rpcErr && typeof rpcCount === "number") {
      // Optional project-scoped client pass for immediate UI consistency
      if (projectId) {
        const today = todayKst();
        await supabase
          .from("tbm_sessions" as any)
          .update({ is_active: false })
          .eq("project_id", projectId)
          .eq("is_active", true)
          .lt("tbm_date", today)
          .or("is_deleted.is.null,is_deleted.eq.false");
      }
      return { ok: true, closed: rpcCount };
    }
  } catch {
    /* fall through */
  }

  const today = todayKst();
  let q = supabase
    .from("tbm_sessions" as any)
    .update({ is_active: false })
    .eq("is_active", true)
    .lt("tbm_date", today)
    .or("is_deleted.is.null,is_deleted.eq.false");
  if (projectId) q = q.eq("project_id", projectId);
  const { data, error } = await q.select("id");
  if (error) return { ok: false, error: error.message };
  return { ok: true, closed: ((data as any[]) || []).length };
}

/**
 * After final issuance approve (not closure/extend), ensure linked TBM exists.
 * Safe to call repeatedly — reuses existing tbm_session_id.
 */
export async function ensureTbmAfterPermitIssued(opts: {
  entityType?: string | null;
  entityId?: string | null;
  projectId?: string | null;
  companyId?: string | null;
  rpcResult?: { finalized?: boolean; action?: string; success?: boolean } | null;
  /** Skip rpcResult.finalized check (legacy direct status update). */
  force?: boolean;
}): Promise<TbmFromPermitResult | { ok: true; skipped: true }> {
  const r = opts.rpcResult;
  if (!opts.force) {
    if (!r || r.finalized !== true) return { ok: true, skipped: true };
    if (r.action && r.action !== "approved") return { ok: true, skipped: true };
  }
  if (opts.entityType && opts.entityType !== "work_permit") {
    return { ok: true, skipped: true };
  }
  const permitId = opts.entityId;
  if (!permitId) return { ok: true, skipped: true };

  let projectId = opts.projectId || null;
  let companyId = opts.companyId || null;
  if (!projectId) {
    const { data: p } = await supabase
      .from("work_permits" as any)
      .select("project_id, company_id, tbm_session_id, status")
      .eq("id", permitId)
      .maybeSingle();
    if (!p) return { ok: false, error: "허가서를 찾을 수 없습니다." };
    projectId = (p as any).project_id;
    companyId = companyId || (p as any).company_id;
  }
  if (!projectId) return { ok: false, error: "프로젝트 없음" };

  return ensureTbmForPermit({
    permitId,
    projectId,
    companyId,
    useAiDraft: true,
  });
}
