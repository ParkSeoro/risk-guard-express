import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { formatLegalCalcPrintHtml, legalCalcVerdictKo } from "../../supabase/functions/_shared/legalCalcPrint";

function escapeHtml(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

describe("법정계산 미리보기", () => {
  it("JSON 원문을 표로 바꾼다", () => {
    const raw = JSON.stringify({
      updatedAt: "2026-08-31T04:57:36.995Z",
      entries: [{
        id: "rigging_overall",
        label: "리깅플랜 종합 안전성",
        verdict: "pass",
        conclusion: "적합 — 장비 안전율 1.18",
        legalBasis: "산업안전보건기준에 관한 규칙 제38조 별표 4(중량물), 제132조~제146조",
      }],
    });
    const html = formatLegalCalcPrintHtml(raw, escapeHtml);
    expect(html).toContain("<table>");
    expect(html).toContain("리깅플랜 종합 안전성");
    expect(html).toContain("적합");
    expect(html).toContain("장비 안전율 1.18");
    expect(html).toContain("제38조");
    expect(html).not.toContain("updatedAt");
    expect(html).not.toContain('"entries"');
  });

  it("maps verdicts", () => {
    expect(legalCalcVerdictKo("pass")).toBe("적합");
    expect(legalCalcVerdictKo("fail")).toBe("부적합");
    expect(legalCalcVerdictKo("warn")).toBe("주의");
  });

  it("edge renderSection prints _legal_calc as a table, not a text dump", () => {
    const edge = readFileSync("supabase/functions/generate-workplan-pdf/index.ts", "utf8");
    expect(edge).toContain("_legal_calc");
    expect(edge).toContain("formatLegalCalcPrintHtml");
  });
});
