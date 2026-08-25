/**
 * Prepare work-plan print payload on the client:
 * - PDF attachments → Storage JPEG URLs (sharp, small Edge body)
 * - risk_assessment xlsx → printable table rows
 * Concurrent callers for the same plan share one raster job.
 */
import { supabase } from "@/integrations/supabase/client";
import { parseRiskAssessmentExcel } from "@/lib/riskExcelImport";
import {
  pickRiskPrintHeaders,
  type PrintRasterProgressFn,
  type WorkPlanRiskPrintTable,
} from "@/lib/pdfRenderHelpers";

export type WorkPlanPrintPayload = {
  planId: string;
  renderedAttachments: Record<string, string[]>;
  riskTable: WorkPlanRiskPrintTable | null;
  /** Attachment keys already represented as body tables — skip file dump pages. */
  skipAttachmentKeys: string[];
};

function isExcelMime(mime: string, url: string): boolean {
  const m = (mime || "").toLowerCase();
  if (m.includes("spreadsheet") || m.includes("excel")) return true;
  return /\.(xlsx|xls|csv)($|\?)/i.test(url);
}

function isRiskAssessmentAttachment(a: {
  attachment_key?: string | null;
  name?: string | null;
}): boolean {
  const key = String(a.attachment_key || "").toLowerCase();
  const name = String(a.name || "");
  if (key === "risk_assessment" || key.includes("risk_assessment")) return true;
  if (name.includes("위험성평가")) return true;
  return false;
}

export async function fetchRiskTableFromExcelUrl(url: string): Promise<WorkPlanRiskPrintTable | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const parsed = parseRiskAssessmentExcel(buf);
    const headers = pickRiskPrintHeaders(parsed.headers);
    const rows = parsed.rows.map((row) => headers.map((h) => String(row[h] ?? "").trim()));
    return { source: "excel", headers, rows };
  } catch (e) {
    console.warn("[workPlanPrint] excel RA parse failed", e);
    return null;
  }
}

type Inflight = {
  promise: Promise<WorkPlanPrintPayload>;
  listeners: Set<PrintRasterProgressFn>;
};

const inflightByPlan = new Map<string, Inflight>();

async function prepareWorkPlanPrintPayloadInner(
  planId: string,
  onProgress?: PrintRasterProgressFn,
): Promise<WorkPlanPrintPayload> {
  const { data: plan, error: planErr } = await supabase
    .from("work_plans")
    .select("id, project_id")
    .eq("id", planId)
    .single();
  if (planErr || !plan?.project_id) {
    throw new Error(planErr?.message || "작업계획서를 찾을 수 없습니다.");
  }

  const { data: atts } = await supabase
    .from("work_plan_attachments")
    .select("file_url, mime_type, attachment_key, name")
    .eq("work_plan_id", planId)
    .eq("is_deleted", false);

  const rows = atts || [];
  const skipAttachmentKeys: string[] = [];
  let riskTable: WorkPlanRiskPrintTable | null = null;

  const raExcel = rows.find(
    (a) =>
      a.file_url &&
      isRiskAssessmentAttachment(a) &&
      isExcelMime(a.mime_type || "", a.file_url),
  );
  if (raExcel?.file_url) {
    riskTable = await fetchRiskTableFromExcelUrl(raExcel.file_url);
    if (riskTable) {
      skipAttachmentKeys.push(String(raExcel.attachment_key || "risk_assessment"));
    }
  }

  const pdfAtts = rows.filter((a) => {
    if (!a.file_url) return false;
    if (isRiskAssessmentAttachment(a) && isExcelMime(a.mime_type || "", a.file_url)) return false;
    const mime = (a.mime_type || "").toLowerCase();
    return mime === "application/pdf" || /\.pdf($|\?)/i.test(a.file_url);
  });

  const { renderAttachmentsToStorageUrls } = await import("@/lib/pdfRender");
  const renderedAttachments = await renderAttachmentsToStorageUrls(
    pdfAtts,
    plan.project_id,
    planId,
    { onProgress },
  );

  return {
    planId,
    renderedAttachments,
    riskTable,
    skipAttachmentKeys,
  };
}

export async function prepareWorkPlanPrintPayload(
  planId: string,
  opts?: { onProgress?: PrintRasterProgressFn },
): Promise<WorkPlanPrintPayload> {
  const existing = inflightByPlan.get(planId);
  if (existing) {
    if (opts?.onProgress) existing.listeners.add(opts.onProgress);
    return existing.promise;
  }

  const listeners = new Set<PrintRasterProgressFn>();
  if (opts?.onProgress) listeners.add(opts.onProgress);
  const emit: PrintRasterProgressFn = (p) => {
    listeners.forEach((fn) => fn(p));
  };
  const promise = prepareWorkPlanPrintPayloadInner(planId, emit).finally(() => {
    const cur = inflightByPlan.get(planId);
    if (cur?.promise === promise) inflightByPlan.delete(planId);
  });
  inflightByPlan.set(planId, { promise, listeners });
  return promise;
}
