import { supabase } from "@/integrations/supabase/client";
import {
  buildOfficialInspectionHtml,
  isOfficialInspection,
  normalizeOfficialPayload,
  resultToGrade,
  type OfficialGrade,
  type OfficialInspectionType,
} from "@/lib/legalForms/officialInspectionForms";
import { isPatrolInspection } from "@/lib/legalForms/patrolLog";

/** Build print HTML for an official (SF006–009) safety inspection. Patrol uses its own builder. */
export async function fetchOfficialInspectionPrintHtml(
  inspectionId: string,
  projectLabel?: string,
): Promise<{ html: string } | { error: string }> {
  const { data: ins, error } = await supabase
    .from("safety_inspections" as any)
    .select("*")
    .eq("id", inspectionId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!ins) return { error: "점검을 찾을 수 없습니다." };
  const type = String((ins as any).inspection_type || "");
  if (isPatrolInspection(type)) {
    return { error: "순회 일지는 전체 화면에서 열어 주세요." };
  }
  if (!isOfficialInspection(type)) {
    return { error: "이 점검 유형은 미리보기를 지원하지 않습니다." };
  }

  const locked = ["결재진행", "결재중", "승인완료", "완료"].includes(String((ins as any).status || ""));
  const snap = ((ins as any).submitted_payload || null) as {
    inspection?: Record<string, unknown>;
    items?: Array<{ checklist_code?: string; label?: string; result?: string; grade?: string; note?: string }>;
  } | null;
  const src = locked && snap?.inspection ? snap.inspection : (ins as any);

  let items = snap?.items;
  if (!locked || !items) {
    const { data: its, error: ie } = await supabase
      .from("safety_inspection_items" as any)
      .select("checklist_code, label, result, grade, note")
      .eq("inspection_id", inspectionId)
      .order("sort_order", { ascending: true });
    if (ie) return { error: ie.message };
    items = (its as any[]) || [];
  }

  const html = buildOfficialInspectionHtml({
    type: type as OfficialInspectionType,
    location: String(src.location || ""),
    inspectorName: String(src.inspector_name || ""),
    inspectedAt: String(src.inspected_at || ""),
    projectLabel,
    payload: normalizeOfficialPayload(src.form_payload || {}),
    rows: (items || []).map((it) => ({
      code: String(it.checklist_code || ""),
      label: String(it.label || ""),
      grade: resultToGrade(it.result, it.grade) as OfficialGrade | null,
      note: String(it.note || ""),
    })),
  });
  return { html };
}
