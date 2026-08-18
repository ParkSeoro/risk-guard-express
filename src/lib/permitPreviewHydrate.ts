import type { PermitFormData, PermitSignatures } from "@/components/permits/DigPermitForm";
import { permitRowToFormData } from "@/components/permits/PermitReadOnlyPreview";
import { contactPhonesFromApprovals, mergeApprovalSignatures } from "@/lib/permitApprovalSignatures";
import type { PermitAiBriefing } from "@/lib/permitBriefing";
import { supabase } from "@/integrations/supabase/client";

/** Load stamps + phones for a read-only permit preview (문서보기 / 결재 상세). */
export async function hydratePermitPreview(p: any): Promise<{
  formData: PermitFormData;
  signatures: PermitSignatures;
  briefing: PermitAiBriefing | null;
}> {
  let formData = permitRowToFormData(p);
  let briefing = (p?.ai_briefing as PermitAiBriefing) || null;

  try {
    const { data: fresh } = await supabase
      .from("work_permits" as any)
      .select("ai_briefing")
      .eq("id", p.id)
      .maybeSingle();
    if ((fresh as any)?.ai_briefing) {
      briefing = (fresh as any).ai_briefing as PermitAiBriefing;
    }
  } catch {
    /* keep row briefing */
  }

  const baseSig: PermitSignatures = p?.signatures || {};
  const { data: aps } = await supabase
    .from("approvals")
    .select("position, approver_name, approver_id, status, approved_at, step_order, approval_version")
    .eq("entity_type", "work_permit")
    .eq("entity_id", p.id)
    .order("approval_version", { ascending: false })
    .order("step_order", { ascending: true });
  let versioned = aps || [];
  if (versioned.length > 0) {
    const latestVersion = versioned[0].approval_version;
    versioned = versioned.filter((a: any) => a.approval_version === latestVersion);
  }
  const signatures = mergeApprovalSignatures(baseSig, versioned as any[]);

  try {
    const ids = [...new Set(versioned.map((a: any) => a.approver_id).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, phone")
        .in("user_id", ids);
      const byUser: Record<string, string | null> = {};
      for (const row of profs || []) byUser[(row as any).user_id] = (row as any).phone;
      const phones = contactPhonesFromApprovals(versioned as any[], byUser);
      if (phones.safety_manager_phone || phones.supervisor_phone) {
        formData = {
          ...formData,
          safety_manager_phone: formData.safety_manager_phone || phones.safety_manager_phone || "",
          supervisor_phone: formData.supervisor_phone || phones.supervisor_phone || "",
        };
      }
    }
  } catch {
    /* ignore phone autofill */
  }

  return { formData, signatures, briefing };
}
