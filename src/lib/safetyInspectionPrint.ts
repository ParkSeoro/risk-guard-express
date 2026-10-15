import { supabase } from "@/integrations/supabase/client";
import { A4_PORTRAIT_PX, preparePrintHtmlForPreview } from "@/lib/approvalDocPreview";
import {
  buildOfficialInspectionHtml,
  isOfficialInspection,
  normalizeOfficialPayload,
  resultToGrade,
  type OfficialApprovalSignerInput,
  type OfficialGrade,
  type OfficialInspectionType,
} from "@/lib/legalForms/officialInspectionForms";
import { isPatrolInspection } from "@/lib/legalForms/patrolLog";

/** 안전점검 결재행. 서명칸은 이 행의 이름·소속·승인 시각을 쓴다. */
export async function fetchSafetyInspectionApprovalSigners(
  inspectionId: string,
): Promise<OfficialApprovalSignerInput[]> {
  if (!inspectionId) return [];
  const { data, error } = await supabase
    .from("approvals")
    .select("step, step_order, approver_name, company_name, company_id, status, approved_at, approval_version")
    .eq("entity_type", "safety_inspection")
    .eq("entity_id", inspectionId);
  if (error || !data) return [];
  const ids = [...new Set(data.map((r) => r.company_id).filter((id): id is string => !!id))];
  const types = new Map<string, string>();
  if (ids.length) {
    const { data: cos } = await supabase.from("companies").select("id, type").in("id", ids);
    for (const c of cos || []) types.set(c.id, c.type);
  }
  return data.map((r) => ({
    step: r.step,
    step_order: r.step_order,
    approver_name: r.approver_name,
    company_name: r.company_name,
    company_type: r.company_id ? types.get(r.company_id) || null : null,
    status: r.status,
    approved_at: r.approved_at,
    approval_version: r.approval_version,
  }));
}

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
    items?: Array<{ checklist_code?: string; label?: string; result?: string; grade?: string; note?: string; photos?: string[] | null }>;
  } | null;
  const src = locked && snap?.inspection ? snap.inspection : (ins as any);

  let items = snap?.items;
  if (!locked || !items) {
    const { data: its, error: ie } = await supabase
      .from("safety_inspection_items" as any)
      .select("checklist_code, label, result, grade, note, photos")
      .eq("inspection_id", inspectionId)
      .order("sort_order", { ascending: true });
    if (ie) return { error: ie.message };
    items = (its as any[]) || [];
  }

  const approvals = await fetchSafetyInspectionApprovalSigners(inspectionId);
  const html = preparePrintHtmlForPreview(
    buildOfficialInspectionHtml({
      type: type as OfficialInspectionType,
      location: String(src.location || ""),
      inspectorName: String(src.inspector_name || ""),
      inspectedAt: String(src.inspected_at || ""),
      projectLabel,
      payload: normalizeOfficialPayload(src.form_payload || {}),
      approvals,
      rows: (items || []).map((it) => ({
        code: String(it.checklist_code || ""),
        label: String(it.label || ""),
        grade: resultToGrade(it.result, it.grade) as OfficialGrade | null,
        note: String(it.note || ""),
        photos: Array.isArray(it.photos) ? it.photos : [],
      })),
    }),
    A4_PORTRAIT_PX,
  );
  return { html };
}
