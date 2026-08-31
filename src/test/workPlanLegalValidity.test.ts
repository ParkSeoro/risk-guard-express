import { describe, expect, it } from "vitest";
import {
  ARTICLE38_TYPE_IDS,
  WORK_PLAN_TYPES,
  getWorkPlanType,
  getWorkPlanTypesGrouped,
  workPlanLegalClass,
} from "@/lib/workPlanTemplates";
import { generateAttachments } from "@/lib/attachmentTemplates";
import {
  emptyLegalRiskRows,
  normalizeRiskToLegalSlots,
  usesFixedLegalRisk,
  validateHeavyLiftLegalRisk,
} from "@/lib/workPlanLegalRisk";
import {
  evaluateWorkPlanApprovalGates,
  isRiggingPlanSafe,
  parseLegalCalcSnapshot,
} from "@/lib/workPlanLegalCalcGate";

describe("제38조 전용 유형", () => {
  it("covers all 13 statutory types", () => {
    expect(ARTICLE38_TYPE_IDS.size).toBe(13);
    for (const id of ARTICLE38_TYPE_IDS) {
      expect(getWorkPlanType(id), id).toBeTruthy();
      expect(workPlanLegalClass(id)).toBe("article38");
    }
  });

  it("keeps practical types out of article 38", () => {
    for (const id of ["high_work", "scaffold", "formwork", "confined_space", "other_hazardous", "steel"]) {
      expect(ARTICLE38_TYPE_IDS.has(id)).toBe(false);
      expect(workPlanLegalClass(id)).toBe("practical");
    }
  });

  it("groups create-dialog lists", () => {
    const g = getWorkPlanTypesGrouped();
    expect(g.article38.map((t) => t.id)).toEqual(
      WORK_PLAN_TYPES.filter((t) => ARTICLE38_TYPE_IDS.has(t.id)).map((t) => t.id),
    );
    expect(g.practical.length).toBeGreaterThan(0);
  });

  it("has attachment templates for new types", () => {
    for (const id of ["tower_crane", "vehicle_cargo", "chemical", "electrical", "bridge", "quarry", "track", "shunting"]) {
      const atts = generateAttachments(id);
      expect(atts.length).toBeGreaterThan(5);
      expect(atts.some((a) => a.key === "biz_license")).toBe(true);
    }
  });
});

describe("중량물 별표 4 5대 대책", () => {
  it("is only forced on heavy_lifting", () => {
    expect(usesFixedLegalRisk("heavy_lifting")).toBe(true);
    expect(usesFixedLegalRisk("steel")).toBe(false);
  });

  it("maps AI rows onto the five statutory hazards", () => {
    const rows = normalizeRiskToLegalSlots([
      { hazard: "낙하물 맞음", measure: "인양 반경 통제" },
      { hazard: "추락", situation: "지브 위", measure: "안전대 체결" },
      { hazard: "끼임·협착", measure: "유도자 배치" },
    ]);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.hazard)).toEqual(["추락", "낙하", "전도", "협착", "붕괴"]);
    expect(rows[0].measure).toBe("안전대 체결");
    expect(rows[1].measure).toBe("인양 반경 통제");
    expect(rows[3].measure).toBe("유도자 배치");
    expect(rows[2].measure).toBe("");
  });

  it("blocks submit when any of the five measures is empty", () => {
    const empty = JSON.stringify(emptyLegalRiskRows());
    const errs = validateHeavyLiftLegalRisk(empty);
    expect(errs[0]).toContain("추락");
    expect(errs[0]).toContain("붕괴");

    const filled = normalizeRiskToLegalSlots(
      emptyLegalRiskRows().map((r) => ({ ...r, measure: `${r.hazard} 대책` })),
    );
    expect(validateHeavyLiftLegalRisk(JSON.stringify(filled))).toEqual([]);
  });
});

describe("결재 상신 게이트", () => {
  it("blocks incomplete rigging", () => {
    const b = evaluateWorkPlanApprovalGates({
      workType: "heavy_lifting",
      rigging: { load_weight: 10 },
    });
    expect(b[0]?.tab).toBe("rigging");
    expect(b[0]?.title).toContain("리깅플랜");
  });

  it("blocks NG rigging even when numbers exist", () => {
    const b = evaluateWorkPlanApprovalGates({
      workType: "heavy_lifting",
      rigging: {
        load_weight: 80,
        working_radius: 10,
        crane_model: "테스트",
        crane_capacity: 10,
        rated_capacity: 10,
        safety_factor: 0.1,
        equipment_ok: "N.G",
        sling_ok: "N.G",
        shackle_ok: "N.G",
        sling_count: 2,
        sling_angle_deg: 60,
      },
    });
    expect(isRiggingPlanSafe({
      load_weight: 80,
      working_radius: 10,
      crane_model: "테스트",
      crane_capacity: 10,
      rated_capacity: 10,
      safety_factor: 0.1,
    })).toBe(false);
    expect(b.some((x) => x.title.includes("부적합"))).toBe(true);
  });

  it("blocks missing or failed legal calc on excavation", () => {
    expect(
      evaluateWorkPlanApprovalGates({ workType: "excavation", snapshot: null })[0]?.title,
    ).toContain("미실시");

    const fail = parseLegalCalcSnapshot({
      updatedAt: "x",
      entries: [{ id: "excavation_slope", label: "사면", verdict: "fail", conclusion: "기울기 부족" }],
    });
    expect(evaluateWorkPlanApprovalGates({ workType: "excavation", snapshot: fail })[0]?.title).toContain("부적합");

    const pass = parseLegalCalcSnapshot({
      updatedAt: "x",
      entries: [{ id: "excavation_slope", label: "사면", verdict: "pass", conclusion: "적합" }],
    });
    expect(evaluateWorkPlanApprovalGates({ workType: "excavation", snapshot: pass })).toEqual([]);
  });

  it("does not use the legal-calc tab as a crane re-entry gate", () => {
    expect(evaluateWorkPlanApprovalGates({
      workType: "heavy_lifting",
      rigging: { load_weight: 1 },
      snapshot: { updatedAt: "", entries: [] },
    })[0]?.tab).toBe("rigging");
  });
});
