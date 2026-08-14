/**
 * Include company managers on permit 을지 roster (same list as field workers).
 * Managers = project_members with admin roles for the permit company.
 * Ensures a workers row exists so work_permit_workers FK still works.
 */
import { supabase } from "@/integrations/supabase/client";
import { ADMIN_PROJECT_ROLES } from "@/lib/permissions";
import { digitsOnlyPhone } from "@/lib/workerAuth";
import type { PermitWorkerRow } from "@/lib/permitWorkers";

export const PERMIT_ROSTER_MANAGER_ROLE_SET = new Set<string>(ADMIN_PROJECT_ROLES);

export type PermitRosterCandidate = PermitWorkerRow & {
  isManager?: boolean;
  managerRole?: string | null;
};

function roleToJobType(role: string): string {
  if (role === "safety_manager") return "안전관리자";
  return "관리감독자";
}

/** Synthetic unique phone when profile has none — keeps UNIQUE(project_id, phone). */
function syntheticManagerPhone(userId: string): string {
  const hex = userId.replace(/-/g, "").slice(0, 8);
  const n = Number.parseInt(hex, 16) % 100_000_000;
  return `020${String(n).padStart(8, "0")}`;
}

/**
 * Load admin members of the permit company and ensure each has a workers row.
 * Returns candidates marked isManager=true (deduped by worker id).
 */
export async function loadPermitCompanyManagerCandidates(opts: {
  projectId: string;
  companyId: string;
  companyName?: string | null;
}): Promise<{ ok: true; managers: PermitRosterCandidate[] } | { ok: false; error: string }> {
  const { projectId, companyId } = opts;
  if (!projectId || !companyId) return { ok: true, managers: [] };

  const { data: members, error: mErr } = await supabase
    .from("project_members")
    .select("user_id, role_new, company_id")
    .eq("project_id", projectId)
    .eq("company_id", companyId);
  if (mErr) return { ok: false, error: mErr.message };

  const admins = ((members || []) as any[]).filter(
    (m) => m.user_id && m.role_new && PERMIT_ROSTER_MANAGER_ROLE_SET.has(String(m.role_new)),
  );
  if (admins.length === 0) return { ok: true, managers: [] };

  const userIds = admins.map((m) => m.user_id as string);
  const { data: profiles, error: pErr } = await supabase
    .from("profiles")
    .select("user_id, display_name, phone")
    .in("user_id", userIds);
  if (pErr) return { ok: false, error: pErr.message };

  const profileByUser = new Map((profiles || []).map((p: any) => [p.user_id, p]));
  let companyName = opts.companyName || "";
  if (!companyName) {
    const { data: c } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle();
    companyName = (c as any)?.name || "";
  }

  // Existing workers for phone match
  const { data: existingWorkers, error: wErr } = await supabase
    .from("workers")
    .select("id, name, phone, company_id, company_name, job_type, is_active")
    .eq("project_id", projectId)
    .eq("is_active", true);
  if (wErr) return { ok: false, error: wErr.message };

  const workerByPhone = new Map<string, any>();
  for (const w of (existingWorkers || []) as any[]) {
    const d = digitsOnlyPhone(w.phone);
    if (d) workerByPhone.set(d, w);
  }

  const out: PermitRosterCandidate[] = [];
  const seenWorkerIds = new Set<string>();

  for (const m of admins) {
    const role = String(m.role_new);
    const prof = profileByUser.get(m.user_id);
    const name = String(prof?.display_name || "").trim() || "관리자";
    const profileDigits = digitsOnlyPhone(prof?.phone);
    const phone = profileDigits || syntheticManagerPhone(m.user_id);
    const digits = digitsOnlyPhone(phone) || phone;

    let worker = workerByPhone.get(digits);
    if (!worker) {
      const insertPayload = {
        project_id: projectId,
        name,
        phone: digits,
        company_id: companyId,
        company_name: companyName,
        job_type: roleToJobType(role),
        is_active: true,
        hire_date: new Date().toISOString().slice(0, 10),
      };
      const { data: inserted, error: iErr } = await supabase
        .from("workers")
        .insert(insertPayload as any)
        .select("id, name, phone, company_id, company_name, job_type")
        .single();
      if (iErr) {
        // Race: another row with same phone — reload
        const { data: again } = await supabase
          .from("workers")
          .select("id, name, phone, company_id, company_name, job_type")
          .eq("project_id", projectId)
          .eq("phone", digits)
          .maybeSingle();
        if (!again) return { ok: false, error: iErr.message };
        worker = again;
      } else {
        worker = inserted;
      }
      workerByPhone.set(digits, worker);
    } else if (worker.company_id !== companyId) {
      // Don't steal another firm's worker row
      continue;
    } else {
      // Keep active + company label current
      await supabase
        .from("workers")
        .update({
          is_active: true,
          company_id: companyId,
          company_name: companyName || worker.company_name,
          name: name || worker.name,
        } as any)
        .eq("id", worker.id);
    }

    if (!worker?.id || seenWorkerIds.has(worker.id)) continue;
    seenWorkerIds.add(worker.id);
    out.push({
      id: worker.id,
      name: worker.name || name,
      phone: worker.phone || digits,
      company_id: companyId,
      company_name: companyName || worker.company_name,
      isManager: true,
      managerRole: role,
    });
  }

  out.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko"));
  return { ok: true, managers: out };
}

/** Merge field workers + managers; managers win isManager flag on same id. */
export function mergePermitRosterCandidates(
  fieldWorkers: PermitWorkerRow[],
  managers: PermitRosterCandidate[],
): PermitRosterCandidate[] {
  const byId = new Map<string, PermitRosterCandidate>();
  for (const w of fieldWorkers) {
    byId.set(w.id, { ...w, isManager: false });
  }
  for (const m of managers) {
    const prev = byId.get(m.id);
    byId.set(m.id, {
      ...(prev || {}),
      ...m,
      isManager: true,
    });
  }
  return [...byId.values()].sort((a, b) => {
    // Managers first, then name
    if (!!a.isManager !== !!b.isManager) return a.isManager ? -1 : 1;
    return (a.name || "").localeCompare(b.name || "", "ko");
  });
}
