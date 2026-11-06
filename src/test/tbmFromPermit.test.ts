import { describe, it, expect } from "vitest";
import {
  buildTbmSeedFromPermit,
  canManagePermitCrew,
  linkedTbmMatchesWorkDate,
  permitStatusAllowsTbm,
  permitWorkDateForTbm,
  resolvePermitAuthorName,
  templateBriefingSummary,
  TBM_WAITS_FOR_APPROVAL,
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

  it("does not seed 굴착 TBM hints from 굴착·중장비 kind plus 투입장비 only", () => {
    const seed = buildTbmSeedFromPermit({
      permit_date: "2026-08-03",
      permit_kinds: ["general", "excavation"],
      form_data: {
        work_name: "자재 양중",
        hz_heavy: true,
        hz_heavy_equipment_name: "지게차 3t",
      },
    });
    expect(seed.prohibited_actions).toMatch(/투입장비 지게차/);
    expect(seed.prohibited_actions).not.toMatch(/굴착:/);
  });

  it("does not seed 굴착 TBM from 비상연락망·우천중지 checks", () => {
    const seed = buildTbmSeedFromPermit({
      permit_date: "2026-09-01",
      permit_kinds: ["general", "hot_work", "excavation"],
      form_data: {
        work_name: "LCO2 TANK 설치 작업",
        hz_heavy: true,
        hz_heavy_equipment_name: "50톤 크레인, 7톤 지게차",
        ex_safety: {
          "비상연락망 게시": true,
          "우천/강풍 시 작업중지 기준": true,
          "유도자/신호수 배치": true,
        },
      },
    });
    expect(seed.prohibited_actions).toMatch(/중장비/);
    expect(seed.prohibited_actions).not.toMatch(/굴착:/);
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

  it("dates a new TBM on the permit work day", () => {
    const seed = buildTbmSeedFromPermit({
      permit_date: "2026-11-05",
      form_data: { work_start: "2026-11-06T08:00", work_name: "배관" },
    });
    expect(seed.tbm_date).toBe("2026-11-06");
    expect(permitWorkDateForTbm({ permit_date: "2026-11-06" })).toBe("2026-11-06");
  });

  it("does not treat a draft or in-approval permit as ready for a TBM", () => {
    expect(permitStatusAllowsTbm("작성중")).toBe(false);
    expect(permitStatusAllowsTbm("결재중")).toBe(false);
    expect(permitStatusAllowsTbm("승인")).toBe(true);
    expect(permitStatusAllowsTbm("종료대기")).toBe(true);
    expect(TBM_WAITS_FOR_APPROVAL).toMatch(/결재가 끝나면/);
  });

  it("reuses a link only when the log date is the work day", () => {
    expect(linkedTbmMatchesWorkDate("2026-11-06", "2026-11-06")).toBe(true);
    expect(linkedTbmMatchesWorkDate("2026-11-05", "2026-11-06")).toBe(false);
    expect(linkedTbmMatchesWorkDate("2026-11-06T00:00:00+09:00", "2026-11-06")).toBe(true);
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
    ).toBe("상신자");
    expect(
      resolvePermitAuthorName(
        { form_data: { applicant_name: "신청자김" } },
        "현재유저",
      ),
    ).toBe("신청자김");
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
