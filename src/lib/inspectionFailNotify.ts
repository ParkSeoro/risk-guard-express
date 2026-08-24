import { supabase } from "@/integrations/supabase/client";

/**
 * 불합격 알람은 항목을 누르는 즉시가 아니라, 일지 저장/완료 시점에
 * 남아 있는 fail 만 보낸다. (작성 중 오클릭 → 합격 정정 시 허위 알람 방지)
 */
export async function notifyInspectionFailSummary(opts: {
  projectId: string;
  inspectionId: string;
  location: string;
  failLabels: string[];
}): Promise<void> {
  const labels = (opts.failLabels || []).map((s) => String(s || "").trim()).filter(Boolean);
  if (!labels.length || !opts.projectId || !opts.inspectionId) return;

  const { data: members } = await supabase
    .from("project_members")
    .select("user_id, role_new")
    .eq("project_id", opts.projectId)
    .in("role_new", ["project_admin", "safety_manager"]);

  const { sendNotification } = await import("@/lib/notificationService");
  const preview = labels.length === 1 ? labels[0] : `${labels[0]} 외 ${labels.length - 1}건`;
  const seen = new Set<string>();
  await Promise.all(
    ((members as { user_id?: string }[]) || []).map((m) => {
      const uid = m.user_id;
      if (!uid || seen.has(uid)) return Promise.resolve();
      seen.add(uid);
      return sendNotification({
        user_id: uid,
        title: "안전점검 불합격 발생",
        message: `${opts.location || "현장"} · ${preview}`,
        type: "inspection_fail",
        related_id: opts.inspectionId,
        related_type: "safety_inspection",
        project_id: opts.projectId,
      });
    }),
  );
}

/** 불합격 → 합격/해당없음으로 정정하면 미조치 요청을 닫는다. */
export async function closePendingInspectionAction(itemId: string): Promise<void> {
  if (!itemId) return;
  await supabase
    .from("safety_inspection_actions" as any)
    .update({
      status: "done",
      completion_note: "점검 결과 합격/해당없음으로 정정",
      completed_at: new Date().toISOString(),
    })
    .eq("item_id", itemId)
    .eq("status", "pending");
}
