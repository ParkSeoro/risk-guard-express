import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  RIGGING_PRINT_LABELS,
  renderRiggingPrintHtml,
  wireSafeLoadPrintNote,
  slingHitchPrintNote,
} from "../../supabase/functions/_shared/riggingPrintHtml";
import {
  LIFTING_METHOD_OPTIONS,
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

  it("선회 추가 감률은 인양 방식 이름과 다른 말로 인쇄한다", () => {
    const html = renderRiggingPrintHtml(
      { sling_method: "선회인양", boom_rotation_factor: 0.8 },
      escapeHtml,
    );
    expect(html).toContain("선회인양");
    expect(html).toContain("선회 추가 감률 ×0.8");
    expect(html).not.toContain("선회 인양 중");
    expect(LIFTING_METHOD_OPTIONS.find((o) => o.value === "선회인양")?.label).toBe(
      "선회인양 (들어서 옆으로 옮김)",
    );
  });

  it("와이어 안전하중은 제조사 값인지 지름 표인지 적는다", () => {
    expect(wireSafeLoadPrintNote({
      sling_material_type: "wire_rope",
      wire_manufacturer_safe_load: 40,
      wire_safe_load: 61.25,
    })).toBe("제조사 안전하중 40t");
    expect(wireSafeLoadPrintNote({
      sling_material_type: "wire_rope",
      wire_safe_load: 61.25,
    })).toBe("지름 표 계산 61.25t");
    expect(wireSafeLoadPrintNote({
      sling_material_type: "round_sling",
      wire_manufacturer_safe_load: 40,
    })).toBe("");
    expect(slingHitchPrintNote({ sling_hitch: "choke" })).toBe("choke (올가미)");
    expect(slingHitchPrintNote({
      sling_hitch: "straight",
      sling_combination: "parallel",
      sling_assembly_safe_load: 12,
    })).toBe("straight (수직 1줄) · 디바이스 나란히 · 조합 사용하중 12t");

    const html = renderRiggingPrintHtml(
      {
        sling_material_type: "wire_rope",
        wire_diameter_mm: 75,
        wire_manufacturer_safe_load: 40,
        wire_safe_load: 61.25,
        sling_method: "직인양",
      },
      escapeHtml,
    );
    expect(html).toContain("와이어 안전하중");
    expect(html).toContain("제조사 안전하중 40t");
  });

  it("슬링벨트는 한국어로 적고 와이어 0mm·빈 지반은 숨긴다", () => {
    const html = renderRiggingPrintHtml(
      {
        load_weight: 2.3,
        load_description: "천정 폐기물 인양 및 철거 기성재 운반",
        crane_model: "엑시언트",
        crane_capacity: 4.5,
        working_radius: 8,
        boom_length: 18.03,
        sling_material_type: "sling_belt",
        sling_type: "sling_belt",
        sling_angle_deg: 60,
        sling_count: 4,
        wire_diameter_mm: 0,
        ground_bearing_capacity: 0,
        sling_belt_width_mm: 100,
        sling_belt_rated_load: 4,
        sling_safe_load: 4,
        tension_per_leg: 0.66,
        equipment_working_load: 4.5,
        total_weight_max: 2.3,
        safety_factor: 1.03,
        calculated_utilization: 97.2,
        equipment_ok: "O.K",
        sling_ok: "O.K",
        shackle_ok: "O.K",
        wind_speed_grade: "0~5",
      },
      escapeHtml,
    );
    expect(html).toContain("슬링벨트 (웹슬링)");
    expect(html).toContain("벨트 폭");
    expect(html).toContain("100mm");
    expect(html).toContain("1줄 장력");
    expect(html).toContain("0.66t");
    expect(html).toContain("적용 정격 4.5t");
    expect(html).toContain("총중량 2.3t");
    expect(html).not.toContain("sling_belt");
    expect(html).not.toContain("와이어 직경");
    expect(html).not.toMatch(/>0mm</);
    expect(html).not.toContain("지반 지지력");
  });
});
