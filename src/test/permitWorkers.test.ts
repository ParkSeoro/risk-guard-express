import { describe, it, expect } from "vitest";
import { buildPersonnelCountPatch, formatWorkerPhone } from "@/lib/permitWorkers";

describe("permitWorkers helpers", () => {
  it("syncs personnel_count into form_data without dropping other fields", () => {
    const patch = buildPersonnelCountPatch(
      { work_name: "배관", personnel_count: 1 },
      5,
    );
    expect(patch.personnel_count).toBe(5);
    expect(patch.form_data).toEqual({ work_name: "배관", personnel_count: 5 });
  });

  it("handles null form_data", () => {
    expect(buildPersonnelCountPatch(null, 3)).toEqual({
      personnel_count: 3,
      form_data: { personnel_count: 3 },
    });
  });

  it("formats phone numbers", () => {
    expect(formatWorkerPhone("01012345678")).toBe("010-1234-5678");
    expect(formatWorkerPhone(null)).toBe("-");
  });
});
