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

/** PC: never enlarge past A4 CSS px. Phone: shrink to the viewport width. */
export function previewFitScale(viewportWidth: number, pageWidth: number): number {
  if (viewportWidth <= 0 || pageWidth <= 0) return 1;
  return Math.min(1, viewportWidth / pageWidth);
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
html, body { width: ${pageWidthPx}px !important; min-width: ${pageWidthPx}px !important; background: #fff; overflow: visible !important; color: #111 !important; }
.no-print { display: none !important; }
@media print {
  html, body {
    width: auto !important;
    min-width: 0 !important;
    max-width: none !important;
  }
}
</style>`;
  const raw = String(html || "");
  if (/<\/head>/i.test(raw)) return raw.replace(/<\/head>/i, `${inject}</head>`);
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">${inject}</head><body>${raw}</body></html>`;
}

const AUTH_EXPIRED_MSG =
  "로그인 세션이 만료되었거나 인증에 실패했습니다. 다시 로그인해 주세요.";

function friendlyPreviewError(msg: string, status?: number): string {
  const s = String(msg || "").trim();
  if (status === 401 || /invalid token|unauthorized/i.test(s)) return AUTH_EXPIRED_MSG;
  if (/non-2xx/i.test(s)) return "문서를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.";
  return s || "인쇄 문서를 만들지 못했습니다";
}

/** Exported for tests — supabase-js hides non-2xx bodies on FunctionsHttpError.context. */
export async function invokeErrorMessage(err: unknown, data: any): Promise<string> {
  if (data?.error) return friendlyPreviewError(String(data.error));
  if (data?.message) return friendlyPreviewError(String(data.message));

  const ctx = err && typeof err === "object" ? (err as any).context : null;
  if (ctx && typeof ctx === "object") {
    const status = typeof ctx.status === "number" ? ctx.status : undefined;
    if (status === 546) {
      return "PDF 서버 제한(546)에 걸렸습니다. 잠시 후 다시 시도해 주세요.";
    }
    if (typeof ctx.json === "function") {
      try {
        const body =
          typeof ctx.clone === "function" ? await ctx.clone().json() : await ctx.json();
        const inner = body?.error || body?.message || body?.detail;
        if (inner) return friendlyPreviewError(String(inner), status);
      } catch {
        /* ignore parse errors */
      }
    }
    if (typeof ctx.body === "string" && ctx.body.trim()) {
      try {
        const parsed = JSON.parse(ctx.body);
        const inner = parsed?.error || parsed?.message;
        if (inner) return friendlyPreviewError(String(inner), status);
      } catch {
        /* ignore */
      }
    }
    if (status === 401) return AUTH_EXPIRED_MSG;
  }

  const msg =
    err && typeof err === "object" && "message" in err && (err as Error).message
      ? String((err as Error).message)
      : "";
  return friendlyPreviewError(msg || String(err || "인쇄 문서를 만들지 못했습니다"));
}

export async function fetchAssessmentPrintHtml(runId: string): Promise<string> {
  const resp = await supabase.functions.invoke("generate-pdf", {
    body: { runId, type: "assessment" },
  });
  const html = resp.data?.html;
  if (resp.error || !html || String(html).length < 100) {
    throw new Error(await invokeErrorMessage(resp.error, resp.data));
  }
  return preparePrintHtmlForPreview(String(html), A4_LANDSCAPE_PX);
}

/** Body + 결재 HTML only. Attachments stay as original files in the UI / packet PDF. */
export async function fetchWorkPlanPrintHtml(planId: string): Promise<string> {
  const { prepareWorkPlanPrintPayload } = await import("@/lib/workPlanPrintPrep");
  const payload = await prepareWorkPlanPrintPayload(planId);

  const resp = await supabase.functions.invoke("generate-workplan-pdf", {
    body: {
      planId,
      riskTable: payload.riskTable,
      skipAttachmentKeys: payload.skipAttachmentKeys,
    },
  });
  const html = resp.data?.html;
  if (resp.error || !html || String(html).length < 100) {
    throw new Error(await invokeErrorMessage(resp.error, resp.data));
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
