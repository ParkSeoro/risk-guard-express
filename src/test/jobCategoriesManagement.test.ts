import { describe, expect, it } from "vitest";
import { isManagementJobType, MANAGEMENT_JOB_TYPES } from "@/lib/jobCategories";

describe("isManagementJobType", () => {
  it("flags 안전관리자 and 관리감독자", () => {
    expect(isManagementJobType("안전관리자")).toBe(true);
    expect(isManagementJobType("관리감독자")).toBe(true);
    expect(MANAGEMENT_JOB_TYPES).toContain("안전관리자");
  });

  it("treats craft trades as field workers", () => {
    expect(isManagementJobType("전기공")).toBe(false);
    expect(isManagementJobType("비계공")).toBe(false);
    expect(isManagementJobType("화재감시자")).toBe(false);
    expect(isManagementJobType(null)).toBe(false);
    expect(isManagementJobType("")).toBe(false);
  });
});
