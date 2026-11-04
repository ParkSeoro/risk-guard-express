import { entityTypeLabel } from "@/lib/approvalRules";
import { INSPECTION_TYPE_LABELS } from "@/lib/inspectionTemplates";
import { workPlanDisplayTitle } from "@/lib/cloneWorkPlan";

const PROCESS_INSPECTION_TYPES = new Set([
  "pre_work",
  "during_work",
  "weekly",
  "monthly",
  "special",
]);

export function safetyInspectionApprovalTitle(row: {
  inspection_type?: string | null;
  process_category?: string | null;
  location?: string | null;
}): string {
  const type = String(row.inspection_type || "");
  const known = (INSPECTION_TYPE_LABELS as Record<string, string>)[type] || "";
  const category = String(row.process_category || "").trim();
  const location = String(row.location || "").trim();
  let name = known;
  if (name && PROCESS_INSPECTION_TYPES.has(type) && category && category !== "공식양식") {
    name = `${name} · ${category}`;
  }
  if (!name) return location;
  if (location && !name.includes(location)) return `${name} · ${location}`;
  return name;
}

export function workPermitApprovalTitle(row: {
  work_name?: string | null;
  work_description?: string | null;
}): string {
  return String(row.work_name || "").trim() || String(row.work_description || "").trim();
}

type TitleRow = Record<string, unknown>;

function text(row: TitleRow, key: string): string {
  return String(row[key] ?? "").trim();
}

/** 결재 카드 제목. 문서 종류 배지와 겹치는 일반 이름만 있으면 빈 문자열. */
export function formatApprovalDocumentTitle(entityType: string, row: TitleRow): string {
  switch (entityType) {
    case "work_plan":
      return text(row, "title") ? workPlanDisplayTitle(text(row, "title")) : "";
    case "work_permit":
      return workPermitApprovalTitle({
        work_name: text(row, "work_name"),
        work_description: text(row, "work_description"),
      });
    case "safety_inspection":
      return safetyInspectionApprovalTitle({
        inspection_type: text(row, "inspection_type"),
        process_category: text(row, "process_category"),
        location: text(row, "location"),
      });
    case "safety_cost":
      return text(row, "title") || text(row, "report_month");
    case "tbm":
      return text(row, "title") || [text(row, "tbm_date"), text(row, "location")].filter(Boolean).join(" ");
    case "emergency_drill":
      return text(row, "title") || text(row, "location");
    case "incident":
      return text(row, "location") || text(row, "incident_type");
    default:
      return "";
  }
}

export function approvalTitleKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

/** 결재 카드 큰 제목. 종류는 배지가 보여 주고, 여기에는 문서 이름을 둔다. */
export function approvalCardHeading(opts: {
  entityType?: string | null;
  entityId?: string | null;
  periodLabel?: string | null;
  titles?: Record<string, string>;
}): string {
  const typeLabel = entityTypeLabel(opts.entityType);
  const period = String(opts.periodLabel || "").trim();
  if (
    (opts.entityType === "assessment_run" || opts.entityType === "assessment_run_feedback") &&
    period
  ) {
    return period;
  }
  const key = opts.entityType && opts.entityId ? approvalTitleKey(opts.entityType, opts.entityId) : "";
  const looked = key ? String(opts.titles?.[key] || "").trim() : "";
  return looked || typeLabel;
}
