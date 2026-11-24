/**
 * Client-side OCR helper for Health Checkup Reports (배치전/일반/특수/수시/임시).
 * - Converts image or multi-page PDF (auto-selecting the judgment/opinion page) to lightweight 1500px JPEG.
 * - Calls dedicated `analyze-health-checkup` Edge Function.
 * - Suggests statutory next checkup due date (OSH Act Annex 23) when not printed on report.
 * - Recommends enabling `requires_daily_health_log` for 유소견/요관찰/작업제한 workers.
 */
import { supabase } from "@/integrations/supabase/client";
import { classifyOcrFileSupport } from "@/lib/workPlanOcrHelpers";
import type { HealthCheckupResult, HealthCheckupType } from "@/lib/healthCheckupExcel";

const OCR_MAX_DIM_PX = 1500;
const OCR_JPEG_QUALITY = 0.82;
const MAX_PDF_SCAN_PAGES = 10;

export interface HealthCheckupOcrResult {
  ok: boolean;
  error?: string;
  workerName: string | null;
  type: HealthCheckupType | null;
  result: HealthCheckupResult | null;
  conductedDate: string | null;
  nextDueDate: string | null;
  suggestedNextDueDate: string | null;
  institution: string | null;
  restrictions: string | null;
  hazardFactors: string[];
  recommendDailyHealthLog: boolean;
  confidence: "high" | "medium" | "low";
  summary: string;
}

const SIX_MONTH_HAZARD_RE = /(벤젠|디메틸포름아미드|DMF|디클로로프로판|야간작업|1,1,2,2|사염화탄소|이황화탄소|염화비닐)/i;

function addMonthsIso(dateIso: string, months: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return null;
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * Suggests statutory next checkup due date when not explicitly printed on the report:
 * - 특수/배치전 with 6-month high-hazard factors (OSH Act Annex 23) -> +6 months
 * - 일반/특수/배치전 standard -> +12 months
 */
export function suggestNextCheckupDueDate(
  conductedDate?: string | null,
  type?: HealthCheckupType | null,
  hazardFactors: string[] = [],
): string | null {
  if (!conductedDate || !/^\d{4}-\d{2}-\d{2}$/.test(conductedDate)) return null;
  if (type === "수시" || type === "임시") return null;
  const hasSixMonthHazard =
    (type === "특수" || type === "배치전") &&
    hazardFactors.some((f) => SIX_MONTH_HAZARD_RE.test(f));
  return addMonthsIso(conductedDate, hasSixMonthHazard ? 6 : 12);
}

/**
 * Recommends enabling `workers.requires_daily_health_log` for 유소견/요관찰/작업제한 cases.
 */
export function shouldRecommendDailyHealthLog(
  result?: HealthCheckupResult | null,
  restrictions?: string | null,
): boolean {
  if (result === "유소견D1" || result === "유소견D2" || result === "요관찰C") return true;
  const r = String(restrictions || "").trim();
  if (!r) return false;
  if (/^(정상|특이사항\s*없음|없음|정상업무\s*가능|적합)$/i.test(r)) return false;
  return /(제한|주의|금지|경과관찰|재검|관리|고혈압|당뇨)/.test(r);
}

const CHECKUP_PAGE_KEYWORDS: Array<{ re: RegExp; weight: number }> = [
  { re: /(판정|유소견|요관찰|정상A|정상B|업무수행\s*적합)/, weight: 5 },
  { re: /(배치전|특수건강진단|일반건강진단|건강진단\s*결과표)/, weight: 4 },
  { re: /(사후관리|작업제한|유해인자|검진기관|차기)/, weight: 3 },
];

export function pickHealthCheckupPdfPage(pageTexts: string[]): number {
  let bestPage = 1;
  let bestScore = 0;
  for (let i = 0; i < pageTexts.length; i += 1) {
    const txt = String(pageTexts[i] || "");
    if (txt.trim().length < 15) continue;
    let score = 0;
    for (const kw of CHECKUP_PAGE_KEYWORDS) {
      if (kw.re.test(txt)) score += kw.weight;
    }
    if (score > bestScore) {
      bestScore = score;
      bestPage = i + 1;
    }
  }
  return bestPage;
}

export function normalizeHealthCheckupOcrResponse(
  raw: Record<string, unknown> | null | undefined,
): HealthCheckupOcrResult {
  if (!raw || raw.ok !== true) {
    return {
      ok: false,
      error: typeof raw?.error === "string" ? raw.error : "결과지 AI 판독에 실패했습니다.",
      workerName: null,
      type: null,
      result: null,
      conductedDate: null,
      nextDueDate: null,
      suggestedNextDueDate: null,
      institution: null,
      restrictions: null,
      hazardFactors: [],
      recommendDailyHealthLog: false,
      confidence: "low",
      summary: "",
    };
  }

  const type = (typeof raw.type === "string" ? raw.type : null) as HealthCheckupType | null;
  const result = (typeof raw.result === "string" ? raw.result : null) as HealthCheckupResult | null;
  const conductedDate = typeof raw.conducted_date === "string" ? raw.conducted_date : null;
  const nextDueDate = typeof raw.next_due_date === "string" ? raw.next_due_date : null;
  const restrictions = typeof raw.restrictions === "string" ? raw.restrictions : null;
  const hazardFactors = Array.isArray(raw.hazard_factors)
    ? raw.hazard_factors.map((x) => String(x || "").trim()).filter(Boolean)
    : [];

  const suggestedNextDueDate =
    nextDueDate || suggestNextCheckupDueDate(conductedDate, type, hazardFactors);

  return {
    ok: true,
    workerName: typeof raw.worker_name === "string" ? raw.worker_name : null,
    type,
    result,
    conductedDate,
    nextDueDate,
    suggestedNextDueDate,
    institution: typeof raw.institution === "string" ? raw.institution : null,
    restrictions,
    hazardFactors,
    recommendDailyHealthLog: shouldRecommendDailyHealthLog(result, restrictions),
    confidence:
      raw.confidence === "high" || raw.confidence === "medium" || raw.confidence === "low"
        ? raw.confidence
        : "medium",
    summary: typeof raw.summary === "string" ? raw.summary : "",
  };
}

async function imageToJpegBase64(file: File): Promise<string> {
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
    return canvas.toDataURL("image/jpeg", OCR_JPEG_QUALITY).split(",")[1] || "";
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function pdfToBestPageJpeg(file: File): Promise<{ base64: string; extractedTextHint?: string }> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), useWorkerFetch: false }).promise;
  const scanCount = Math.min(Math.max(1, pdf.numPages || 1), MAX_PDF_SCAN_PAGES);
  const texts: string[] = [];
  for (let p = 1; p <= scanCount; p += 1) {
    try {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      texts.push(content.items.map((it: any) => (typeof it?.str === "string" ? it.str : "")).join(" "));
    } catch {
      texts.push("");
    }
  }
  const targetPage = pickHealthCheckupPdfPage(texts);
  const page = await pdf.getPage(targetPage);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2.2, OCR_MAX_DIM_PX / Math.max(baseViewport.width || 1, baseViewport.height || 1));
  const viewport = page.getViewport({ scale: Math.max(0.5, scale) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("PDF Canvas 초기화 실패");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return {
    base64: canvas.toDataURL("image/jpeg", OCR_JPEG_QUALITY).split(",")[1] || "",
    extractedTextHint: (texts[targetPage - 1] || "").trim() || undefined,
  };
}

export async function analyzeHealthCheckupFile(file: File): Promise<HealthCheckupOcrResult> {
  const support = classifyOcrFileSupport({ name: file.name, type: file.type });
  if (support === "unsupported") {
    return normalizeHealthCheckupOcrResponse({
      ok: false,
      error: "이미지(JPG/PNG/WebP) 또는 PDF 결과지만 AI 판독이 가능합니다.",
    });
  }

  let base64 = "";
  let extractedTextHint: string | undefined;
  try {
    if (support === "image") {
      base64 = await imageToJpegBase64(file);
    } else {
      const rendered = await pdfToBestPageJpeg(file);
      base64 = rendered.base64;
      extractedTextHint = rendered.extractedTextHint;
    }
  } catch (err: any) {
    return normalizeHealthCheckupOcrResponse({
      ok: false,
      error:
        support === "haansoft_pdf"
          ? "한컴 PDF 형식은 지원되지 않습니다. 표준 PDF 또는 이미지로 변환해 주세요."
          : `결과지 변환 실패: ${err?.message || "오류"}`,
    });
  }

  try {
    const { data, error } = await supabase.functions.invoke("analyze-health-checkup", {
      body: {
        base64,
        mimeType: "image/jpeg",
        fileName: file.name,
        extractedTextHint,
      },
    });
    if (error) {
      return normalizeHealthCheckupOcrResponse({ ok: false, error: error.message || "AI 판독 요청 실패" });
    }
    return normalizeHealthCheckupOcrResponse(data as Record<string, unknown>);
  } catch (err: any) {
    return normalizeHealthCheckupOcrResponse({
      ok: false,
      error: err?.message || "AI 판독 중 오류가 발생했습니다.",
    });
  }
}
