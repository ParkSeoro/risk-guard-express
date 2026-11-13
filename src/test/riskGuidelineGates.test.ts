import { describe, expect, it } from "vitest";
import { normalizeProcessKey } from "@/lib/processKeyAlias";
import { matchOpinionRiskToLibrary } from "@/lib/opinionLibraryMatch";
import { retentionBlocksDelete, retentionUnlockDate, improvementPlanDateLabel } from "@/lib/assessmentRetention";
import { repConsultGap, trivialExclusionReason } from "@/lib/assessmentSubmitPreflight";

describe("process key alias", () => {
  it("folds 철근배근 into 철근 배근 and leaves 철근공사", () => {
    expect(normalizeProcessKey("철근배근")).toBe("철근 배근");
    expect(normalizeProcessKey("철근 배근")).toBe("철근 배근");
    expect(normalizeProcessKey("철근공사")).toBe("철근공사");
  });
});

describe("assessment retention", () => {
  it("unlocks the day after completion plus three years", () => {
    expect(retentionUnlockDate("2026-11-13")).toBe("2029-11-14");
    expect(retentionBlocksDelete("2026-11-13", "2029-11-13")).toBe(true);
    expect(retentionBlocksDelete("2026-11-13", "2029-11-14")).toBe(false);
    expect(retentionBlocksDelete(null, "2026-11-13")).toBe(false);
    expect(improvementPlanDateLabel("2026-11-13")).toBe("개선대책 수립일 11월 13일. 보존은 다음 날부터 3년");
  });
});

describe("rep consult and trivial exclusion", () => {
  it("names only the empty consult fields", () => {
    expect(repConsultGap({ requested: false, schedule: "" })).toBeNull();
    expect(repConsultGap({ requested: true, schedule: "내일", scope: "", method: "" })).toContain("범위·방법");
  });

  it("rejects a reason that is only 경미", () => {
    expect(trivialExclusionReason("매우 경미")).toBe(true);
    expect(trivialExclusionReason("작업이 끝나 해당 없음")).toBe(false);
  });
});

describe("opinion library match", () => {
  it("uses the library sentence when the hazard matches", () => {
    const matched = matchOpinionRiskToLibrary(
      { hazard: "추락", sub_task: "고소", likelihood_grade: "상" },
      [{ process: "철골", sub_task: "고소", hazard: "추락", hazard_situation: "난간 없음", improvement_measure: "안전대", likelihood_grade: "중", severity_grade: "상" }],
    );
    expect(matched.fromLibrary).toBe(true);
    expect(matched.hazard_situation).toBe("난간 없음");
    expect(matched.likelihood_grade).toBe("중");
  });

  it("keeps a new draft when nothing matches", () => {
    const matched = matchOpinionRiskToLibrary({ hazard: "질식" }, [{ hazard: "추락", sub_task: "고소" }]);
    expect(matched.fromLibrary).toBe(false);
    expect(matched.hazard).toBe("질식");
  });
});
