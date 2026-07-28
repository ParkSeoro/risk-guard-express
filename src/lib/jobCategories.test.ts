import { describe, expect, it } from "vitest";
import {
  JOB_CATEGORIES,
  STANDARD_JOB_TYPES,
  isStandardJobType,
  jobTypeSchema,
  toLegalEducationJobType,
} from "@/lib/jobCategories";

describe("jobCategories SSOT", () => {
  it("has no 기타 and only grouped standard jobs", () => {
    const flat = Object.values(JOB_CATEGORIES).flat();
    expect(flat).toHaveLength(STANDARD_JOB_TYPES.length);
    expect(flat).not.toContain("기타");
    expect(STANDARD_JOB_TYPES).not.toContain("기타");
  });

  it("rejects free-text and 기타 via Zod", () => {
    expect(jobTypeSchema.safeParse("기타").success).toBe(false);
    expect(jobTypeSchema.safeParse("직접입력").success).toBe(false);
    expect(jobTypeSchema.safeParse("용접공").success).toBe(true);
    expect(isStandardJobType("신호수/유도수")).toBe(true);
  });

  it("maps plant jobs to legal education codes", () => {
    expect(toLegalEducationJobType("용접공")).toBe("welding");
    expect(toLegalEducationJobType("관리감독자")).toBe("manager");
    expect(toLegalEducationJobType("")).toBe("general");
  });
});
