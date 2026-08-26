import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { collectPrintableAttachments, workPlanPacketFileName, concatPdfBytes, a4PortraitHeightPx, a4SliceCount, planPdfPageStarts, rangesFromPageStarts } from "@/lib/workPlanPacketPdf";

describe("collectPrintableAttachments", () => {
  it("keeps pdf and images, skips excel RA and empty slots", () => {
    const files = collectPrintableAttachments(
      [
        { file_url: "https://x/a.pdf", mime_type: "application/pdf", name: "신호수 지정서", attachment_key: "signal" },
        { file_url: "https://x/b.jpg", mime_type: "image/jpeg", name: "현장사진", attachment_key: "photo" },
        { file_url: "https://x/ra.xlsx", mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name: "위험성평가", attachment_key: "risk_assessment" },
        { file_url: null, mime_type: null, name: "미첨부", attachment_key: "empty" },
        { file_url: "https://x/c.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", name: "워드", attachment_key: "doc" },
      ],
      ["risk_assessment"],
    );
    expect(files.map((f) => f.key)).toEqual(["signal", "photo"]);
    expect(files[0].kind).toBe("pdf");
    expect(files[1].kind).toBe("image");
  });
});

describe("workPlanPacketFileName", () => {
  it("strips path characters", () => {
    expect(workPlanPacketFileName('100t크레인/작업계획서')).toMatch(/^100t크레인_작업계획서_\d{6}\.pdf$/);
  });
});

describe("A4 body slices", () => {
  it("counts full pages for a tall canvas", () => {
    expect(a4PortraitHeightPx(794)).toBe(1123);
    expect(a4SliceCount(1123, 1123)).toBe(1);
    expect(a4SliceCount(1124, 1123)).toBe(2);
    expect(a4SliceCount(3369, 1123)).toBe(3);
  });

  it("moves a keep-together box that would be split onto the next page", () => {
    const starts = planPdfPageStarts({
      contentH: 1500,
      pageH: 1123,
      blocks: [
        { top: 40, bottom: 900 },
        { top: 910, bottom: 1070, keepWithNext: true },
        { top: 1070, bottom: 1220 },
      ],
    });
    expect(starts).toContain(0);
    expect(starts).toContain(910);
    const ranges = rangesFromPageStarts(starts, 1500);
    expect(ranges[0].height).toBe(910);
    expect(ranges[1].start).toBe(910);
  });

  it("keeps a box that already fits on the page", () => {
    const starts = planPdfPageStarts({
      contentH: 800,
      pageH: 1123,
      blocks: [{ top: 100, bottom: 400 }],
    });
    expect(starts).toEqual([0]);
  });
});

describe("concatPdfBytes", () => {
  it("joins two one-page PDFs", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const a = await PDFDocument.create();
    a.addPage([100, 100]);
    const b = await PDFDocument.create();
    b.addPage([200, 200]);
    const out = await concatPdfBytes([await a.save(), await b.save()]);
    const merged = await PDFDocument.load(out);
    expect(merged.getPageCount()).toBe(2);
  });
});

describe("preview / print / save split contracts", () => {
  it("preview HTML fetch does not raster attachments", () => {
    const preview = readFileSync("src/lib/approvalDocPreview.ts", "utf8");
    expect(preview).toContain("prepareWorkPlanPrintPayload");
    expect(preview).toContain("riskTable");
    expect(preview).not.toContain("renderedAttachments");
    expect(preview).not.toContain("includeAttachmentImages");

    const prep = readFileSync("src/lib/workPlanPrintPrep.ts", "utf8");
    expect(prep).toContain("fetchRiskTableFromExcelUrl");
    expect(prep).not.toContain("renderAttachmentsToStorageUrls");
  });

  it("WorkPlanDetail splits PDF save and print", () => {
    const src = readFileSync("src/pages/WorkPlanDetail.tsx", "utf8");
    expect(src).toContain("handleSavePdf");
    expect(src).toContain("handlePrint");
    expect(src).toContain("buildWorkPlanPacketPdf");
    expect(src).toContain("mergeOriginalAttachmentsPdf");
    expect(src).toContain("printHtmlDocument");
    expect(src).toContain("waitForAfterPrint");
    expect(src).toContain("AttachmentReviewPanel");
    expect(src).toContain("ZoomableDocumentPreview");
    expect(src).not.toContain("handlePdfDownload");
    expect(src).not.toContain("prepareWorkPlanPrintPayload");
    expect(src).not.toMatch(/onClick=\{handleSavePdf\} disabled=\{saving\}/);
    expect(src).not.toMatch(/onClick=\{handlePrint\} disabled=\{saving\}/);
  });

  it("approval and mobile preview load original attachments separately", () => {
    const dialog = readFileSync("src/components/approval/ApprovalDocPreviewDialog.tsx", "utf8");
    expect(dialog).toContain("AttachmentReviewPanel");
    expect(dialog).toContain("본문을 불러오는 중");
    expect(dialog).not.toContain("첨부 변환");
    const mobile = readFileSync("src/pages/MobileWorkPlanViewer.tsx", "utf8");
    expect(mobile).toContain("fetchWorkPlanPrintHtml(planId)");
    expect(mobile).toContain("AttachmentReviewPanel");
    expect(mobile).not.toContain("onProgress");
  });

  it("edge body HTML lists attachments but does not embed rasters", () => {
    const edge = readFileSync("supabase/functions/generate-workplan-pdf/index.ts", "utf8");
    expect(edge).toContain("첨부서류 일람");
    expect(edge).toContain("원본으로 이어집니다");
    expect(edge).toContain("print-keep-together");
    expect(edge).toContain("riskTable");
    expect(edge).not.toContain("renderedAttachments");
    expect(edge).not.toContain("attachment-print-page");
    expect(edge).not.toContain("PDF 미리보기 이미지를 만들지 못했습니다");
    expect(edge).not.toMatch(/position:\s*fixed/);
  });

  it("print helper can wait for afterprint", () => {
    const src = readFileSync("src/lib/printHtmlDocument.ts", "utf8");
    expect(src).toContain("waitForAfterPrint");
    expect(src).toContain("afterprint");
  });

  it("PDF save slices the body into A4 pages instead of jspdf.html", () => {
    const src = readFileSync("src/lib/workPlanPacketPdf.ts", "utf8");
    expect(src).toContain("html2canvas");
    expect(src).toContain("planPdfPageStarts");
    expect(src).toContain("collectKeepTogetherBlocks");
    expect(src).toContain("print-keep-together");
    expect(src).toContain("sliceCanvas");
    expect(src).not.toMatch(/from ["']jspdf["']/);
    expect(src).not.toContain("autoPaging");
  });

  it("preview uses native scroll and never enlarges past A4 on PC", () => {
    const preview = readFileSync("src/lib/approvalDocPreview.ts", "utf8");
    expect(preview).toContain("previewFitScale");
    expect(preview).toContain("Math.min(1, viewportWidth / pageWidth)");
    const view = readFileSync("src/components/docs/ZoomableDocumentPreview.tsx", "utf8");
    expect(view).toContain("previewFitScale");
    expect(view).toContain("overflow-y-scroll");
    expect(view).not.toContain("overflow-hidden");
    expect(view).not.toContain("touch-none");
  });
});
