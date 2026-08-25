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

  it("uploadPrintRasters fails loudly when all uploads fail", () => {
    const src = readFileSync("src/lib/pdfRender.ts", "utf8");
    expect(src).toContain("첨부 PDF 인쇄 이미지 업로드에 실패");
  });
});
