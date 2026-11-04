import { describe, expect, it } from "vitest";
import {
  approvalCardHeading,
  formatApprovalDocumentTitle,
  safetyInspectionApprovalTitle,
  workPermitApprovalTitle,
} from "@/lib/approvalDocumentTitle";
import { approvalEntityIdsByType } from "@/lib/loadApprovalDocumentTitles";

describe("approval document titles", () => {
  it("uses the permit work name", () => {
    expect(workPermitApprovalTitle({ work_name: "터파기, 토사반출", work_description: "설명" })).toBe(
      "터파기, 토사반출",
    );
    expect(workPermitApprovalTitle({ work_name: "  ", work_description: "버림타설" })).toBe("버림타설");
  });

  it("names an inspection by form and place", () => {
    expect(
      safetyInspectionApprovalTitle({
        inspection_type: "daily_sf006",
        location: "현장내 소방펌프실",
      }),
    ).toBe("일일 안전점검표 · 현장내 소방펌프실");
    expect(
      safetyInspectionApprovalTitle({
        inspection_type: "pre_work",
        process_category: "굴착",
        location: "A구간",
      }),
    ).toBe("작업 전 점검(일일) · 굴착 · A구간");
    expect(safetyInspectionApprovalTitle({ inspection_type: "patrol", location: "북측 울타리" })).toBe(
      "순회 점검 · 북측 울타리",
    );
  });

  it("drops stacked round marks from a work plan title", () => {
    expect(
      formatApprovalDocumentTitle("work_plan", {
        title: "터파기, 토사반출, 버림타설_6838_박철_06W (v8) (v9) (v10)",
      }),
    ).toBe("터파기, 토사반출, 버림타설_6838_박철_06W");
  });

  it("shows the document name beside the type badge", () => {
    expect(
      approvalCardHeading({
        entityType: "work_permit",
        entityId: "p1",
        titles: { "work_permit:p1": "버림타설" },
      }),
    ).toBe("버림타설");
    expect(approvalCardHeading({ entityType: "work_permit", entityId: "missing" })).toBe("작업허가서");
    expect(
      approvalCardHeading({
        entityType: "assessment_run",
        entityId: "r1",
        periodLabel: "2026년 10월 1주차",
      }),
    ).toBe("2026년 10월 1주차");
  });

  it("groups ids by document type once", () => {
    expect(
      approvalEntityIdsByType([
        { entity_type: "work_permit", entity_id: "p1" },
        { entity_type: "work_permit", entity_id: "p1" },
        { entity_type: "safety_inspection", entity_id: "s1" },
        { entity_type: "assessment_run", entity_id: "r1" },
      ]),
    ).toEqual({
      work_permit: ["p1"],
      safety_inspection: ["s1"],
    });
  });
});
