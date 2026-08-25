import { supabase } from "@/integrations/supabase/client";

/** A4 landscape at 96dpi — 위험성평가 인쇄 HTML (`@page { size: A4 landscape }`). */
export const A4_LANDSCAPE_PX = 1123;
/** A4 portrait at 96dpi — 작업계획서 인쇄 HTML. */
export const A4_PORTRAIT_PX = 794;

export const MIN_USER_SCALE = 0.8;
export const MAX_USER_SCALE = 5;

const APPROVED_PUBLISH = new Set(["승인완료", "승인", "완료"]);

/**
 * Worker browse lists stay approved-only.
 * Inbox / deep-link viewers are not filtered by this.
 */
export function isApprovedPublishStatus(status: string | null | undefined): boolean {
  return APPROVED_PUBLISH.has(String(status || "").trim());
}

/** Any loaded run/plan is readable on mobile; authoring stays on PC. */
export function isMobileDocReadable(_status: string | null | undefined): boolean {
  return true;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function fitWidthScale(viewportWidth: number, pageWidth: number): number {
  if (viewportWidth <= 0 || pageWidth <= 0) return 1;
  return viewportWidth / pageWidth;
}

/** Document pan: pin to top-left when smaller; clamp to edges when larger. */
export function clampDocumentPan(
  tx: number,
  ty: number,
  scale: number,
  contentW: number,
  contentH: number,
  vpW: number,
  vpH: number,
): { tx: number; ty: number } {
  const w = contentW * scale;
  const h = contentH * scale;
  let nextTx = tx;
  let nextTy = ty;
  if (w <= vpW) nextTx = (vpW - w) / 2;
  else nextTx = clamp(tx, vpW - w, 0);
  if (h <= vpH) nextTy = 0;
  else nextTy = clamp(ty, vpH - h, 0);
  return { tx: nextTx, ty: nextTy };
}

export function preparePrintHtmlForPreview(html: string, pageWidthPx: number): string {
  const inject = `<meta name="viewport" content="width=${pageWidthPx}, user-scalable=no">
<style id="safenex-preview-fit">
html, body { width: ${pageWidthPx}px !important; min-width: ${pageWidthPx}px !important; background: #fff; overflow: visible !important; }
.no-print { display: none !important; }
/* Preview width must NOT constrain print — Chrome "PDF로 저장" would crush attachment rasters. */
@media print {
  html, body {
    width: auto !important;
    min-width: 0 !important;
    max-width: none !important;
  }
  img.attachment-print-img,
  .attachment-print-img {
    width: 100% !important;
    max-width: 100% !important;
    max-height: none !important;
    height: auto !important;
    object-fit: contain !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
}
</style>`;
  const raw = String(html || "");
  if (/<\/head>/i.test(raw)) return raw.replace(/<\/head>/i, `${inject}</head>`);
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">${inject}</head><body>${raw}</body></html>`;
}

function invokeErrorMessage(err: unknown, data: any): string {
  if (data?.error) return String(data.error);
  if (err && typeof err === "object" && "message" in err && (err as Error).message) {
    return String((err as Error).message);
  }
  return String(err || "인쇄 문서를 만들지 못했습니다");
}

export async function fetchAssessmentPrintHtml(runId: string): Promise<string> {
  const resp = await supabase.functions.invoke("generate-pdf", {
    body: { runId, type: "assessment" },
  });
  const html = resp.data?.html;
  if (resp.error || !html || String(html).length < 100) {
    throw new Error(invokeErrorMessage(resp.error, resp.data));
  }
  return preparePrintHtmlForPreview(String(html), A4_LANDSCAPE_PX);
}

export async function fetchWorkPlanPrintHtml(
  planId: string,
  opts?: { includeAttachmentImages?: boolean },
): Promise<string> {
  const includeAttachmentImages = opts?.includeAttachmentImages !== false;
  let renderedAttachments: Record<string, string[]> = {};
  if (includeAttachmentImages) {
    const { data: atts } = await supabase
      .from("work_plan_attachments")
      .select("file_url, mime_type")
      .eq("work_plan_id", planId)
      .eq("is_deleted", false);
    const { renderAttachmentsToImages } = await import("@/lib/pdfRender");
    renderedAttachments = await renderAttachmentsToImages(atts || []);
  }
  const resp = await supabase.functions.invoke("generate-workplan-pdf", {
    body: { planId, renderedAttachments },
  });
  const html = resp.data?.html;
  if (resp.error || !html || String(html).length < 100) {
    throw new Error(invokeErrorMessage(resp.error, resp.data));
  }
  return preparePrintHtmlForPreview(String(html), A4_PORTRAIT_PX);
}

export function appendFromQuery(path: string, from?: string | null): string {
  if (!from) return path;
  const [base, qs] = path.split("?");
  const params = new URLSearchParams(qs || "");
  params.set("from", from === "approvals" ? "approvals" : from);
  return `${base}?${params.toString()}`;
}
