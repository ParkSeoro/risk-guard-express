/**
 * Client-side lightweight JPEG rasterizer & PDF keyword page finder for Work-Plan OCR.
 * Separate from print-only `pdfPageRasterizer.ts` (8p PNG) — optimized for Vision API speed & size.
 */
import { supabase } from "@/integrations/supabase/client";
import { resolveArchivedUrl } from "@/lib/archiveUrlResolver";
import {
  classifyOcrFileSupport,
  normalizeOcrResponse,
  pickBestKeywordPage,
  type WorkPlanOcrResult,
} from "@/lib/workPlanOcrHelpers";

const OCR_MAX_DIM_PX = 1500;
const OCR_JPEG_QUALITY = 0.82;
const MAX_TEXT_SCAN_PAGES = 20;

export interface OcrAvailableSlot {
  key: string;
  name: string;
}

async function imageFileToJpegBase64(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("이미지를 불러올 수 없습니다."));
      el.src = url;
    });
    const scale = Math.min(1, OCR_MAX_DIM_PX / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 초기화 실패");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", OCR_JPEG_QUALITY);
    return dataUrl.split(",")[1] || "";
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function renderPdfPageToJpeg(
  file: File,
  requestedPage?: number,
): Promise<{
  base64: string;
  pageNumber: number;
  totalPages: number;
  extractedTextHint?: string;
}> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), useWorkerFetch: false }).promise;
  const totalPages = Math.max(1, pdf.numPages || 1);

  let targetPage =
    requestedPage && requestedPage >= 1 && requestedPage <= totalPages ? requestedPage : 0;
  let extractedTextHint = "";

  // Digital PDF keyword page search when caller did not pin a specific page
  if (!targetPage && totalPages > 1) {
    const scanCount = Math.min(totalPages, MAX_TEXT_SCAN_PAGES);
    const texts: string[] = [];
    for (let p = 1; p <= scanCount; p += 1) {
      try {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const str = content.items
          .map((item: any) => (typeof item?.str === "string" ? item.str : ""))
          .join(" ");
        texts.push(str);
      } catch {
        texts.push("");
      }
    }
    const picked = pickBestKeywordPage(texts);
    targetPage = picked || 1;
    extractedTextHint = texts[targetPage - 1] || "";
  } else {
    targetPage = targetPage || 1;
    try {
      const page = await pdf.getPage(targetPage);
      const content = await page.getTextContent();
      extractedTextHint = content.items
        .map((item: any) => (typeof item?.str === "string" ? item.str : ""))
        .join(" ");
    } catch {
      extractedTextHint = "";
    }
  }

  const page = await pdf.getPage(targetPage);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(
    2.2,
    OCR_MAX_DIM_PX / Math.max(baseViewport.width || 1, baseViewport.height || 1),
  );
  const viewport = page.getViewport({ scale: Math.max(0.5, scale) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("PDF Canvas 초기화 실패");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const dataUrl = canvas.toDataURL("image/jpeg", OCR_JPEG_QUALITY);

  return {
    base64: dataUrl.split(",")[1] || "",
    pageNumber: targetPage,
    totalPages,
    extractedTextHint: extractedTextHint.trim() || undefined,
  };
}

/**
 * Analyzes a work-plan attachment file using the dedicated Vision Edge Function.
 * Never throws; returns a structured result with explicit Korean error/fallback guidance.
 */
export async function analyzeWorkPlanAttachmentFile(
  file: File,
  availableSlots: OcrAvailableSlot[],
  opts?: { pageNumber?: number },
): Promise<WorkPlanOcrResult> {
  const allowedKeys = new Set(availableSlots.map((s) => s.key));
  const support = classifyOcrFileSupport({ name: file.name, type: file.type });

  if (support === "unsupported") {
    return normalizeOcrResponse(
      {
        ok: false,
        error: "이미지·PDF 형식만 AI 판독이 가능합니다. 아래에서 항목을 직접 선택해 넣어 주세요.",
      },
      { allowedKeys, pageNumber: 1, totalPages: 1 },
    );
  }

  let base64 = "";
  let pageNumber = opts?.pageNumber || 1;
  let totalPages = 1;
  let extractedTextHint: string | undefined;

  try {
    if (support === "image") {
      base64 = await imageFileToJpegBase64(file);
    } else {
      const rendered = await renderPdfPageToJpeg(file, opts?.pageNumber);
      base64 = rendered.base64;
      pageNumber = rendered.pageNumber;
      totalPages = rendered.totalPages;
      extractedTextHint = rendered.extractedTextHint;
    }
  } catch (err: any) {
    const msg =
      support === "haansoft_pdf"
        ? "한컴 PDF(haansoftpdf) 형식은 AI 판독이 지원되지 않습니다. 표준 PDF 또는 이미지로 변환하거나 수동으로 항목을 선택해 주세요."
        : `파일을 판독용 이미지로 변환하지 못했습니다 (${err?.message || "오류"}). 수동으로 항목을 선택해 주세요.`;
    return normalizeOcrResponse(
      { ok: false, error: msg },
      { allowedKeys, pageNumber, totalPages },
    );
  }

  try {
    const { data, error } = await supabase.functions.invoke("analyze-workplan-attachment", {
      body: {
        images: [{ base64, mimeType: "image/jpeg", pageNumber }],
        fileName: file.name,
        availableSlots,
        extractedTextHint,
        pageNumber,
        totalPages,
      },
    });
    if (error) {
      return normalizeOcrResponse(
        { ok: false, error: error.message || "AI 판독 요청 실패" },
        { allowedKeys, pageNumber, totalPages },
      );
    }
    return normalizeOcrResponse(data as Record<string, unknown>, {
      allowedKeys,
      pageNumber,
      totalPages,
    });
  } catch (err: any) {
    return normalizeOcrResponse(
      { ok: false, error: err?.message || "AI 판독 중 오류가 발생했습니다." },
      { allowedKeys, pageNumber, totalPages },
    );
  }
}

/**
 * Fetches an already-uploaded attachment URL (resolving Drive archives if needed)
 * and runs the exact same Work-Plan Vision OCR pipeline for reviewer / retroactive checks.
 */
export async function analyzeWorkPlanAttachmentUrl(opts: {
  fileUrl: string;
  fileName: string;
  mimeType?: string | null;
  availableSlots: OcrAvailableSlot[];
}): Promise<WorkPlanOcrResult> {
  const allowedKeys = new Set(opts.availableSlots.map((s) => s.key));
  try {
    const resolvedUrl = await resolveArchivedUrl(opts.fileUrl);
    const res = await fetch(resolvedUrl);
    if (!res.ok) {
      return normalizeOcrResponse(
        { ok: false, error: `첨부 파일을 불러오지 못했습니다 (HTTP ${res.status}).` },
        { allowedKeys, pageNumber: 1, totalPages: 1 },
      );
    }
    const blob = await res.blob();
    const mime = opts.mimeType || blob.type || "";
    const hasExt = /\.[a-z0-9]{2,5}$/i.test(opts.fileName);
    const fallbackExt = mime.includes("pdf") ? ".pdf" : mime.startsWith("image/") ? ".jpg" : "";
    const file = new File([blob], hasExt ? opts.fileName : `${opts.fileName}${fallbackExt}`, {
      type: mime,
    });
    return await analyzeWorkPlanAttachmentFile(file, opts.availableSlots);
  } catch (err: any) {
    return normalizeOcrResponse(
      { ok: false, error: err?.message || "첨부 파일 다운로드에 실패했습니다." },
      { allowedKeys, pageNumber: 1, totalPages: 1 },
    );
  }
}
