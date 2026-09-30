import { describe, expect, it } from "vitest";
import { buildWorkPlanCloneInsert, workPlanCloneTitle } from "@/lib/cloneWorkPlan";
import { buildRiggingPlanPayload } from "@/lib/riggingPlanPersist";

const source = {
  id: "plan-1",
  project_id: "proj-1",
  company_id: "co-1",
  work_type: "heavy_lifting",
  title: "사무동 양중",
  version: 3,
  author_user_id: "user-author",
  sections: [
    { key: "overview", content: JSON.stringify({ work_name: "양중", work_location: "사무동" }) },
    { key: "_checklist", content: "[{\"label\":\"신호수 배치\",\"checked\":true}]" },
    { key: "_legal_calc", content: "{\"entries\":[{\"id\":\"rig\"}]}" },
  ],
  start_date: "2026-10-01",
  end_date: "2026-10-31",
  assessment_run_id: "run-1",
  auto_education_enabled: false,
};

describe("작업계획서 회차 복사", () => {
  it("제목에 다음 회차만 붙인다", () => {
    expect(workPlanCloneTitle("사무동 양중", 3)).toBe("사무동 양중 (v4)");
    expect(workPlanCloneTitle("", null)).toBe("작업계획서 (v2)");
  });

  it("본문·작업기간·작성 주체를 복사하고 결재는 작성중으로 둔다", () => {
    const row = buildWorkPlanCloneInsert(source, "user-copier");
    expect(row.project_id).toBe("proj-1");
    expect(row.company_id).toBe("co-1");
    expect(row.work_type).toBe("heavy_lifting");
    expect(row.title).toBe("사무동 양중 (v4)");
    expect(row.version).toBe(4);
    expect(row.status).toBe("작성중");
    expect(row.parent_id).toBe("plan-1");
    expect(row.created_by).toBe("user-copier");
    expect(row.author_user_id).toBe("user-author");
    expect(row.start_date).toBe("2026-10-01");
    expect(row.end_date).toBe("2026-10-31");
    expect(row.sections).toEqual(source.sections);
    expect(row.assessment_run_id).toBe("run-1");
    expect(row.auto_education_enabled).toBe(false);
    expect(row.attachments).toEqual([]);
    expect(row).not.toHaveProperty("voided_at");
    expect(row).not.toHaveProperty("voided_reason");
  });

  it("리깅 숫자는 새 계획서에 그대로 붙인다", () => {
    const payload = buildRiggingPlanPayload("plan-new", {
      id: "old-rig",
      work_plan_id: "plan-1",
      load_weight: 12.5,
      working_radius: 18,
      crane_model: "50톤 크레인",
      crane_capacity: 8,
      wire_diameter_mm: 20,
      wire_safe_load: 4.36,
      wire_manufacturer_safe_load: 5,
      sling_safe_load: 5,
      safety_factor: 1.4,
    });
    expect(payload.work_plan_id).toBe("plan-new");
    expect(payload.load_weight).toBe(12.5);
    expect(payload.working_radius).toBe(18);
    expect(payload.crane_model).toBe("50톤 크레인");
    expect(payload.wire_safe_load).toBe(4.36);
    expect(payload.wire_manufacturer_safe_load).toBe(5);
    expect(payload.sling_safe_load).toBe(5);
    expect(payload).not.toHaveProperty("id");
  });
});
