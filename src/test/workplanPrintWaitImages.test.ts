import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

describe("workplan print waits for images", () => {
  it("exposes waitForDocumentImages + printHtmlDocument helper", () => {
    const src = readFileSync("src/lib/printHtmlDocument.ts", "utf8");
    expect(src).toContain("waitForDocumentImages");
    expect(src).toContain("printHtmlDocument");
    expect(src).toContain("doc.images");
  });

  it("WorkPlanDetail print path uses printHtmlDocument (not fixed 500ms)", () => {
    const src = readFileSync("src/pages/WorkPlanDetail.tsx", "utf8");
    expect(src).toContain("printHtmlDocument");
    expect(src).not.toMatch(/setTimeout\(\(\)\s*=>\s*\{[\s\S]*print\(\)[\s\S]*\},\s*500\)/);
  });

  it("print raster upload fails loudly when all uploads fail", () => {
    const src = readFileSync("src/lib/pdfRender.ts", "utf8");
    expect(src).toContain("첨부 PDF 인쇄 이미지 업로드에 실패");
  });

  it("preview waits for attachment images before measuring layout", () => {
    const src = readFileSync("src/components/docs/ZoomableDocumentPreview.tsx", "utf8");
    expect(src).toContain("waitForDocumentImages");
    expect(src).toContain("imagesReady");
  });

  it("upload warms print-cache and print shows conversion progress", () => {
    const checklist = readFileSync("src/components/work-plan/AttachmentChecklist.tsx", "utf8");
    expect(checklist).toContain("warmWorkPlanAttachmentPrintCache");
    const detail = readFileSync("src/pages/WorkPlanDetail.tsx", "utf8");
    expect(detail).toContain("onProgress");
    expect(detail).toContain("prepareWorkPlanPrintPayload");
  });
});
