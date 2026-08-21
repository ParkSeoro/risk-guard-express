import { describe, expect, it } from "vitest";
import { filterApprovalsKeepingFullDocumentTimeline } from "@/lib/approvalDocumentVisibility";
import { isRiggingPlanReady, summarizeRiggingPlan } from "@/lib/riggingPlanPersist";

describe("filterApprovalsKeepingFullDocumentTimeline", () => {
  const rows = [
    {
      entity_type: "work_plan",
      entity_id: "wp1",
      company_id: "gc1",
      approver_id: "u-gc",
      comment: null,
      status: "승인",
    },
    {
      entity_type: "work_plan",
      entity_id: "wp1",
      company_id: "client1",
      approver_id: "u-sm",
      comment: "리깅플랜 누락",
      status: "반려",
    },
    {
      entity_type: "work_plan",
      entity_id: "wp2",
      company_id: "other",
      approver_id: "u-x",
      comment: null,
      status: "진행중",
    },
  ];

  it("keeps full timeline including owner reject when GC step is in scope", () => {
    const out = filterApprovalsKeepingFullDocumentTimeline(rows, {
      userId: "u-gc",
      accessibleCompanyIds: ["gc1", "gc1-child"],
    });
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.entity_id === "wp1")).toBe(true);
    expect(out.some((r) => r.comment === "리깅플랜 누락")).toBe(true);
  });

  it("does not leak unrelated documents", () => {
    const out = filterApprovalsKeepingFullDocumentTimeline(rows, {
      userId: "nobody",
      accessibleCompanyIds: ["gc1"],
    });
    expect(out.map((r) => r.entity_id)).toEqual(["wp1", "wp1"]);
  });

  it("master/null scope returns all rows", () => {
    const out = filterApprovalsKeepingFullDocumentTimeline(rows, {
      userId: "u-gc",
      accessibleCompanyIds: null,
    });
    expect(out).toHaveLength(3);
  });
});

describe("rigging plan readiness", () => {
  it("requires load, radius, and crane", () => {
    expect(isRiggingPlanReady(null)).toBe(false);
    expect(isRiggingPlanReady({ load_weight: 3 })).toBe(false);
    expect(
      isRiggingPlanReady({
        load_weight: 3,
        working_radius: 10,
        crane_model: "ATF",
      }),
    ).toBe(true);
    expect(
      isRiggingPlanReady({
        load_weight: 3,
        working_radius: 10,
        equipment_name: "크레인A",
      }),
    ).toBe(true);
  });

  it("summarizes for preview", () => {
    const lines = summarizeRiggingPlan({
      load_weight: 5,
      load_description: "탱크",
      working_radius: 12,
      crane_model: "LTM",
      safety_factor: 1.4,
      calculated_utilization: 70,
    });
    expect(lines.some((l) => l.includes("5t"))).toBe(true);
    expect(lines.some((l) => l.includes("LTM"))).toBe(true);
  });
});
