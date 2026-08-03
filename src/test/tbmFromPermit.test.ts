import { describe, it, expect } from "vitest";
import {
  buildTbmSeedFromPermit,
  canManagePermitCrew,
  resolvePermitAuthorName,
  templateBriefingSummary,
} from "@/lib/tbmFromPermit";
import { buildWorkSummary } from "@/lib/dailyWorkAck";

describe("tbmFromPermit", () => {
  it("seeds TBM fields from permit form_data", () => {
    const seed = buildTbmSeedFromPermit({
      permit_date: "2026-08-03",
      permit_kinds: ["hot_work", "general"],
      form_data: {
        work_name: "배관 용접",
        work_description: "3층 배관 용접",
        work_location: "P-301",
        contractor_company: "A협력",
      },
    });
    expect(seed.title).toContain("배관 용접");
    expect(seed.location).toBe("P-301");
    expect(seed.prohibited_actions).toMatch(/화기/);
    expect(seed.special_notes).toMatch(/보호구/);
  });

  it("builds template briefing", () => {
    const seed = buildTbmSeedFromPermit({
      permit_date: "2026-08-03",
      work_description: "도장",
      location: "옥상",
    });
    const text = templateBriefingSummary(seed);
    expect(text).toMatch(/금일 작업/);
    expect(text).toMatch(/도장/);
  });

  it("allows manager roles for crew sync", () => {
    expect(canManagePermitCrew("supervisor")).toBe(true);
    expect(canManagePermitCrew("site_manager")).toBe(true);
    expect(canManagePermitCrew("worker")).toBe(false);
    expect(canManagePermitCrew("viewer", true)).toBe(true);
  });

  it("resolves TBM leader from permit author, not current user", () => {
    expect(
      resolvePermitAuthorName(
        {
          submitted_by_name: "상신자",
          form_data: { applicant_name: "신청자김" },
        },
        "현재유저",
      ),
    ).toBe("신청자김");
    expect(
      resolvePermitAuthorName({ submitted_by_name: "상신자홍" }, "현재유저"),
    ).toBe("상신자홍");
    expect(resolvePermitAuthorName({}, "현재유저")).toBe("현재유저");
  });
});

describe("dailyWorkAck summaries", () => {
  it("lists multiple permits in one summary", () => {
    const text = buildWorkSummary([
      {
        id: "1",
        work_name: "A",
        work_description: "설명A",
        work_location: "L1",
        permit_date: "2026-08-03",
        tbm_session_id: null,
        assessment_run_id: null,
      },
      {
        id: "2",
        work_name: "B",
        work_description: "B",
        work_location: "",
        permit_date: "2026-08-03",
        tbm_session_id: null,
        assessment_run_id: null,
      },
    ]);
    expect(text).toContain("1. A");
    expect(text).toContain("2. B");
  });
});
