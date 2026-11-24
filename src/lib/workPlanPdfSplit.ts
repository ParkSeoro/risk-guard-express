/**
 * Selective Smart PDF Splitter for Work-Plan Attachments (2..10 pages max).
 *
 * Safeguards:
 *  - Strict upper cap (MAX_SMART_SPLIT_PAGES = 10) prevents browser OOM and Vision API abuse
 *    on large single-document PDFs (e.g., 30p crane spec sheets or structural calculations).
 *  - Explicit user-triggered action only (never runs automatically on drop).
 *  - Consecutive pages belonging to the same document (or unlabeled continuation pages)
 *    are grouped together into one clean PDF per document.
 *  - Split results return to the staging inbox with pre-computed OCR results for
 *    1-click user confirmation (never auto-writes to DB).
 */
import { PDFDocument } from "pdf-lib";
import {
  analyzeWorkPlanAttachmentFile,
  type OcrAvailableSlot,
} from "./workPlanOcrClient";
import type { WorkPlanOcrResult } from "./workPlanOcrHelpers";

export const MAX_SMART_SPLIT_PAGES = 10;

export function isEligibleForSmartSplit(totalPages: number): boolean {
  return Number.isInteger(totalPages) && totalPages >= 2 && totalPages <= MAX_SMART_SPLIT_PAGES;
}

export interface PageOcrClassification {
  pageNumber: number; // 1-based
  ocr: WorkPlanOcrResult;
}

export interface SplitPdfGroup {
  suggestedKey: string | null;
  docCategoryLabel: string;
  pages: number[]; // 1-based page numbers
  primaryOcr: WorkPlanOcrResult;
}

/**
 * Pure grouping algorithm:
 * - Consecutive pages with the same non-null `suggestedKey` merge into one group.
 * - A page with `suggestedKey === null` (e.g. page 2 of a multi-page insurance policy)
 *   merges into the immediately preceding group when one exists.
 * - Distinct non-null `suggestedKey` starts a new document group.
 */
export function groupConsecutivePagesBySlot(
  pageResults: PageOcrClassification[],
): SplitPdfGroup[] {
  const sorted = [...pageResults].sort((a, b) => a.pageNumber - b.pageNumber);
  const groups: SplitPdfGroup[] = [];

  for (const item of sorted) {
    const key = item.ocr.suggestedKey || null;
    const prev = groups[groups.length - 1];

    if (prev && ((key !== null && prev.suggestedKey === key) || key === null)) {
      prev.pages.push(item.pageNumber);
      // Keep the highest-confidence OCR metadata (or fill missing expiry/holder)
      if (!prev.primaryOcr.expiryDate && item.ocr.expiryDate) {
        prev.primaryOcr = {
          ...prev.primaryOcr,
          expiryDate: item.ocr.expiryDate,
          expiryStatus: item.ocr.expiryStatus,
        };
      }
      if (!prev.primaryOcr.companyOrHolder && item.ocr.companyOrHolder) {
        prev.primaryOcr = {
          ...prev.primaryOcr,
          companyOrHolder: item.ocr.companyOrHolder,
        };
      }
      continue;
    }

    groups.push({
      suggestedKey: key,
      docCategoryLabel: item.ocr.docCategoryLabel || "미분류 서류",
      pages: [item.pageNumber],
      primaryOcr: { ...item.ocr },
    });
  }

  return groups;
}

function sanitizeFileSegment(raw: string): string {
  return String(raw || "doc")
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40) || "doc";
}

/**
 * Splits a PDF File into separate PDF Files according to grouped 1-based page numbers.
 */
export async function splitPdfFileByGroups(
  originalFile: File,
  groups: SplitPdfGroup[],
): Promise<Array<{ file: File; ocr: WorkPlanOcrResult; pages: number[] }>> {
  const srcBytes = await originalFile.arrayBuffer();
  const srcPdf = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const totalPages = srcPdf.getPageCount();
  const out: Array<{ file: File; ocr: WorkPlanOcrResult; pages: number[] }> = [];

  for (const g of groups) {
    const validZeroBased = g.pages
      .map((p) => p - 1)
      .filter((idx) => idx >= 0 && idx < totalPages);
    if (validZeroBased.length === 0) continue;

    const child = await PDFDocument.create();
    const copied = await child.copyPages(srcPdf, validZeroBased);
    for (const p of copied) child.addPage(p);
    const bytes = await child.save();

    const labelSeg = sanitizeFileSegment(g.docCategoryLabel || g.suggestedKey || "서류");
    const pageTag =
      g.pages.length === 1
        ? `p${g.pages[0]}`
        : `p${g.pages[0]}-${g.pages[g.pages.length - 1]}`;
    const fileName = `${labelSeg}_${pageTag}.pdf`;
    const file = new File([bytes], fileName, { type: "application/pdf" });

    out.push({
      file,
      pages: g.pages,
      ocr: {
        ...g.primaryOcr,
        pageNumber: 1,
        totalPages: g.pages.length,
        needsPageSelect: false,
      },
    });
  }

  return out;
}

export interface SmartSplitOutcome {
  ok: boolean;
  split: boolean;
  message: string;
  items: Array<{ file: File; ocr: WorkPlanOcrResult; pages: number[] }>;
}

/**
 * End-to-end smart splitter:
 *  1) Checks PDF page count (must be 2..10 pages).
 *  2) Runs AI OCR on each page sequentially with progress reporting.
 *  3) Groups consecutive pages of the same document.
 *  4) If 2+ distinct documents are detected, splits via pdf-lib and returns individual Files + OCR.
 */
export async function smartSplitWorkPlanPdf(
  file: File,
  availableSlots: OcrAvailableSlot[],
  onProgress?: (done: number, total: number) => void,
): Promise<SmartSplitOutcome> {
  let totalPages = 0;
  try {
    const buf = await file.arrayBuffer();
    const pdf = await PDFDocument.load(buf, { ignoreEncryption: true });
    totalPages = pdf.getPageCount();
  } catch (e: any) {
    return {
      ok: false,
      split: false,
      message: `PDF 페이지를 읽지 못했습니다 (${e?.message || "오류"}).`,
      items: [],
    };
  }

  if (totalPages < 2) {
    return {
      ok: true,
      split: false,
      message: "1페이지 PDF는 분리할 필요가 없습니다.",
      items: [],
    };
  }
  if (totalPages > MAX_SMART_SPLIT_PAGES) {
    return {
      ok: false,
      split: false,
      message: `${totalPages}페이지 대형 PDF는 단일 문서(제원표·구조검토서 등)로 간주되어 자동 분리를 지원하지 않습니다 (최대 ${MAX_SMART_SPLIT_PAGES}페이지).`,
      items: [],
    };
  }

  const pageResults: PageOcrClassification[] = [];
  for (let p = 1; p <= totalPages; p += 1) {
    onProgress?.(p - 1, totalPages);
    const ocr = await analyzeWorkPlanAttachmentFile(file, availableSlots, { pageNumber: p });
    pageResults.push({ pageNumber: p, ocr });
    onProgress?.(p, totalPages);
  }

  const groups = groupConsecutivePagesBySlot(pageResults);
  if (groups.length <= 1) {
    return {
      ok: true,
      split: false,
      message: "모든 페이지가 하나의 서류로 판독되어 분리하지 않았습니다.",
      items: [],
    };
  }

  const splitItems = await splitPdfFileByGroups(file, groups);
  return {
    ok: true,
    split: true,
    message: `${totalPages}페이지 합본 PDF를 ${splitItems.length}개 서류로 자동 분리했습니다. 각 항목을 확인해 넣어 주세요.`,
    items: splitItems,
  };
}
