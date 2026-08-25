import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { pickRiskPrintHeaders } from "@/lib/pdfRenderHelpers";

describe("pickRiskPrintHeaders", () => {
  it("prefers process/hazard columns", () => {
    const headers = ["비고", "공정", "세부작업", "위험요인", "개선대책", "기타1", "기타2"];
    const picked = pickRiskPrintHeaders(headers, 8);
    expect(picked).toContain("공정");
    expect(picked).toContain("위험요인");
    expect(picked[0]).not.toBe("비고");
  });

  it("falls back to leading columns when hints missing", () => {
    expect(pickRiskPrintHeaders(["A", "B", "C"], 2)).toEqual(["A", "B"]);
  });
});

describe("work-plan print storage + RA table contracts", () => {
  it("client prepares storage URLs and riskTable (no body-only retry)", () => {
    const preview = readFileSync("src/lib/approvalDocPreview.ts", "utf8");
    expect(preview).toContain("prepareWorkPlanPrintPayload");
    expect(preview).toContain("riskTable");
    expect(preview).toContain("skipAttachmentKeys");
    expect(preview).not.toContain("retrying body-only");
    expect(preview).not.toContain("compactRenderedAttachments");

    const prep = readFileSync("src/lib/workPlanPrintPrep.ts", "utf8");
    expect(prep).toContain("renderAttachmentsToStorageUrls");
    expect(prep).toContain("fetchRiskTableFromExcelUrl");
    expect(prep).toContain("parseRiskAssessmentExcel");

    const render = readFileSync("src/lib/pdfRender.ts", "utf8");
    expect(render).toMatch(/PDF_RENDER_SCALE\s*=\s*2/);
    expect(render).toContain("PRINT_CACHE_VERSION");
    expect(render).toContain("listCachedUrls");
    expect(render).toContain("isMostlyGrayscale");
    expect(render).toContain("image/jpeg");
  });

  it("print-cache key is stable per uploaded filename", async () => {
    const { printCacheFileKey, printCachePageName, PRINT_CACHE_VERSION } = await import(
      "@/lib/pdfRenderHelpers"
    );
    expect(PRINT_CACHE_VERSION).toBe("v4");
    expect(
      printCacheFileKey(
        "https://x.supabase.co/storage/v1/object/public/attachments/p/signal_designate_1787630167750.pdf",
      ),
    ).toBe("signal_designate_1787630167750");
    expect(printCachePageName(1)).toBe("p01.jpg");
    expect(printCachePageName(12)).toBe("p12.jpg");
  });

  it("edge accepts riskTable and skips excel dump when table present", () => {
    const edge = readFileSync("supabase/functions/generate-workplan-pdf/index.ts", "utf8");
    expect(edge).toContain("riskTable");
    expect(edge).toContain("skipAttachmentKeys");
    expect(edge).toContain("출처: 업로드된 위험성평가서");
    expect(edge).toContain("PDF 미리보기 이미지를 만들지 못했습니다");
    expect(edge).toContain("attachment-print-page");
    expect(edge).toContain("max-height: 268mm");
    expect(edge).not.toMatch(/position:\s*fixed/);
    expect(edge).not.toMatch(/이 파일 형식은 인쇄본에 직접 포함할 수 없습니다/);
  });
});
