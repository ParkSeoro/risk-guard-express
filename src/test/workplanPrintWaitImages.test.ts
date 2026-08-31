import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("workplan print waits for images", () => {
  it("exposes waitForDocumentImages + printHtmlDocument helper", () => {
    const src = readFileSync("src/lib/printHtmlDocument.ts", "utf8");
    expect(src).toContain("waitForDocumentImages");
    expect(src).toContain("printHtmlDocument");
    expect(src).toContain("doc.images");
    expect(src).toContain("waitForAfterPrint");
  });

  it("WorkPlanDetail print path uses printHtmlDocument (not fixed 500ms)", () => {
    const src = readFileSync("src/pages/WorkPlanDetail.tsx", "utf8");
    expect(src).toContain("printHtmlDocument");
    expect(src).toContain("handlePrint");
    expect(src).not.toMatch(/setTimeout\(\(\)\s*=>\s*\{[\s\S]*print\(\)[\s\S]*\},\s*500\)/);
  });

  it("excel RA fetch has a timeout so desktop preview cannot hang", () => {
    const src = readFileSync("src/lib/workPlanPrintPrep.ts", "utf8");
    expect(src).toContain("EXCEL_FETCH_TIMEOUT_MS");
    expect(src).toContain("AbortController");
    expect(src).toContain("RISK_TABLE_MAX_ROWS");
  });
});
