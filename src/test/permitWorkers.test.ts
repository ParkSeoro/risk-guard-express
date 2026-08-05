import { describe, it, expect } from "vitest";
import {
  buildPersonnelCountPatch,
  filterPermitAssignableWorkers,
  formatWorkerPhone,
} from "@/lib/permitWorkers";

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

  it("keeps only permit-company workers (no peer firms)", () => {
    const rows = [
      { id: "1", company_id: "co-a", company_name: "알파산업(주)" },
      { id: "2", company_id: "co-b", company_name: "정엔지니어링(주)" },
      { id: "3", company_id: null, company_name: "알파산업㈜" },
      { id: "4", company_id: null, company_name: "정엔지니어링(주)" },
    ];
    const filtered = filterPermitAssignableWorkers(rows, "co-a", "알파산업(주)");
    expect(filtered.map((w) => w.id)).toEqual(["1", "3"]);
  });

  it("returns empty when permit has no company", () => {
    expect(
      filterPermitAssignableWorkers(
        [{ id: "1", company_id: "co-a", company_name: "X" }],
        null,
        null,
      ),
    ).toEqual([]);
  });
});
