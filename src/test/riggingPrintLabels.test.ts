import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  RIGGING_PRINT_LABELS,
  renderRiggingPrintHtml,
} from "../../supabase/functions/_shared/riggingPrintHtml";

function escapeHtml(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

describe("리깅플랜 인쇄 제목", () => {
  it("화면과 같은 제목으로 재사용 컬럼을 찍는다", () => {
    const html = renderRiggingPrintHtml(
      {
        lifting_method: "정대용",
        outrigger_setup: "GSC조 내계",
        notes: "2026-09-01 ~ 09-30",
        load_description: "H빔 반입",
        load_weight: 12,
        safety_factor: 1.4,
        calculated_utilization: 70,
      },
      escapeHtml,
    );

    expect(html).toContain(`>${RIGGING_PRINT_LABELS.lifting_method}<`);
    expect(html).toContain("정대용");
    expect(html).not.toContain("인양 방식");

    expect(html).toContain(`>${RIGGING_PRINT_LABELS.outrigger_setup}<`);
    expect(html).toContain("GSC조 내계");
    expect(html).not.toContain("아우트리거");

    expect(html).toContain(`${RIGGING_PRINT_LABELS.notes}:`);
    expect(html).toContain("2026-09-01 ~ 09-30");
    expect(html).not.toMatch(/비고:/);
  });

  it("폼과 PDF가 같은 컬럼에 같은 한국어 제목을 쓴다", () => {
    const form = readFileSync("src/components/rigging/RiggingPlanForm.tsx", "utf8");
    expect(form).toContain(`field('${RIGGING_PRINT_LABELS.outrigger_setup}', 'outrigger_setup'`);
    expect(form).toContain(`field('${RIGGING_PRINT_LABELS.notes}', 'notes'`);
    expect(form).toContain(`field('${RIGGING_PRINT_LABELS.lifting_method}', 'lifting_method'`);

    const edge = readFileSync("supabase/functions/generate-workplan-pdf/index.ts", "utf8");
    expect(edge).toContain("renderRiggingPrintHtml");
    expect(edge).not.toContain("인양 방식");
    expect(edge).not.toContain("아우트리거");
  });
});
