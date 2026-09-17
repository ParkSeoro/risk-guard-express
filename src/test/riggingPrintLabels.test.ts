import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  RIGGING_PRINT_LABELS,
  renderRiggingPrintHtml,
} from "../../supabase/functions/_shared/riggingPrintHtml";
import {
  classifyRiggingLoad,
  riggingLoadBanner,
} from "@/lib/riggingLoadBand";

function escapeHtml(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

describe("리깅플랜 인쇄 제목", () => {
  it("인양 방식 칸은 sling_method이고 작업지휘자 이름은 그 칸에 안 넣는다", () => {
    const html = renderRiggingPrintHtml(
      {
        lifting_method: "정대용",
        sling_method: "직인양",
        outrigger_setup: "GSC조 내계",
        notes: "2026-09-01 ~ 09-30",
        load_description: "H빔 반입",
        load_weight: 12,
        safety_factor: 1.4,
        calculated_utilization: 70,
      },
      escapeHtml,
    );

    expect(html).toContain(`>${RIGGING_PRINT_LABELS.sling_method}<`);
    expect(html).toContain("직인양");
    expect(html).toContain("인양 방식");
    expect(html).toContain("작업지휘자: 정대용");
    expect(html).not.toMatch(/인양 방식<\/td><td>정대용/);

    expect(html).toContain(`>${RIGGING_PRINT_LABELS.outrigger_setup}<`);
    expect(html).toContain("GSC조 내계");
    expect(html).not.toContain("아우트리거");

    expect(html).toContain(`${RIGGING_PRINT_LABELS.notes}:`);
    expect(html).toContain("2026-09-01 ~ 09-30");
    expect(html).not.toMatch(/비고:/);
    expect(html).toContain("부하율");
    expect(html).not.toContain("가동률");
  });

  it("폼과 PDF가 같은 컬럼에 같은 한국어 제목을 쓴다", () => {
    const form = readFileSync("src/components/rigging/RiggingPlanForm.tsx", "utf8");
    expect(form).toContain(`field('${RIGGING_PRINT_LABELS.outrigger_setup}', 'outrigger_setup'`);
    expect(form).toContain(`field('${RIGGING_PRINT_LABELS.notes}', 'notes'`);
    expect(form).toContain(`field('${RIGGING_PRINT_LABELS.lifting_method}', 'lifting_method'`);
    expect(form).toContain("인양 방식");
    expect(form).toContain("sling_method");

    const edge = readFileSync("supabase/functions/generate-workplan-pdf/index.ts", "utf8");
    expect(edge).toContain("renderRiggingPrintHtml");
    expect(edge).not.toContain("아우트리거");
  });
});

describe("리깅 부하율 기준", () => {
  it("75%까지 안전, 그 위는 경고, 정격 초과만 작업금지", () => {
    expect(classifyRiggingLoad({ utilizationPct: 70, safetyFactor: 1.43 })).toBe("ok");
    expect(classifyRiggingLoad({ utilizationPct: 80, safetyFactor: 1.25 })).toBe("warn");
    expect(classifyRiggingLoad({ utilizationPct: 96, safetyFactor: 1.04 })).toBe("warn");
    expect(riggingLoadBanner(classifyRiggingLoad({ utilizationPct: 96, safetyFactor: 1.04 })).label).toBe("경고");
    expect(classifyRiggingLoad({ utilizationPct: 110, safetyFactor: 0.9 })).toBe("over_capacity");
  });

  it("96% 인쇄는 경고이지 작업금지가 아니다", () => {
    const html = renderRiggingPrintHtml(
      { safety_factor: 1.04, calculated_utilization: 96, sling_method: "선회인양" },
      escapeHtml,
    );
    expect(html).toContain("경고");
    expect(html).toContain("96.0%");
    expect(html).toContain("최대 85% 초과");
    expect(html).not.toContain("작업금지");
    expect(html).toContain("선회인양");
  });
});
