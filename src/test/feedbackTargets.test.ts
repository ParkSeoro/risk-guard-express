import { describe, expect, it } from "vitest";
import {
  canAssignFeedbackToItem,
  getFeedbackTargetItems,
  isAutoManagedTarget,
  isCheckedFeedbackTarget,
  isFeedbackExcludeReason,
  missingHighFeedbackCount,
  splitFeedbackOverrides,
} from "@/lib/feedbackTargets";

const high = { id: "h1", improved_risk_grade: "상" as const };
const mid = { id: "m1", improved_risk_grade: "중" as const };

describe("feedbackTargets", () => {
  it("treats 개선후 상 as auto managed", () => {
    expect(isAutoManagedTarget(high)).toBe(true);
    expect(isAutoManagedTarget(mid)).toBe(false);
    expect(isFeedbackExcludeReason("해당없음")).toBe(true);
    expect(isFeedbackExcludeReason("삭제")).toBe(false);
  });

  it("lets an auto item be unchecked when excluded", () => {
    const empty = { manualIds: new Set<string>(), excludedIds: new Set<string>() };
    expect(isCheckedFeedbackTarget(high, empty)).toBe(true);
    expect(
      isCheckedFeedbackTarget(high, { manualIds: new Set(), excludedIds: new Set(["h1"]) }),
    ).toBe(false);
    expect(isCheckedFeedbackTarget(mid, empty)).toBe(false);
    expect(
      isCheckedFeedbackTarget(mid, { manualIds: new Set(["m1"]), excludedIds: new Set() }),
    ).toBe(true);
  });

  it("drops excluded 상 from 이행 targets and missing count", () => {
    const overrides = {
      manualIds: new Set(["m1"]),
      excludedIds: new Set(["h1"]),
    };
    expect(getFeedbackTargetItems([high, mid], overrides).map((i) => i.id)).toEqual(["m1"]);
    expect(missingHighFeedbackCount([high], new Set(), new Set(["h1"]))).toBe(0);
    expect(missingHighFeedbackCount([high], new Set(), new Set())).toBe(1);
    expect(missingHighFeedbackCount([high], new Set(["h1"]), new Set())).toBe(0);
    expect(canAssignFeedbackToItem(high, overrides)).toBe(false);
    expect(canAssignFeedbackToItem(mid, overrides)).toBe(true);
  });

  it("splits override rows into include / exclude", () => {
    const split = splitFeedbackOverrides([
      { risk_item_id: "h1", kind: "exclude", reason: "작업 미실시" },
      { risk_item_id: "m1", kind: "manual_include", reason: null },
    ]);
    expect([...split.excludedIds]).toEqual(["h1"]);
    expect(split.excludeReasons.h1).toBe("작업 미실시");
    expect([...split.manualIds]).toEqual(["m1"]);
  });
});
