import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  groupConsecutivePagesBySlot,
  isEligibleForSmartSplit,
  MAX_SMART_SPLIT_PAGES,
  splitPdfFileByGroups,
} from "@/lib/workPlanPdfSplit";
import type { WorkPlanOcrResult } from "@/lib/workPlanOcrHelpers";

function makeOcr(overrides: Partial<WorkPlanOcrResult> = {}): WorkPlanOcrResult {
  return {
    ok: true,
    pageNumber: 1,
    totalPages: 3,
    suggestedKey: "biz_license",
    docCategoryLabel: "사업자등록증",
    confidence: 0.92,
    companyOrHolder: "청원산기(주)",
    issueDate: null,
    expiryDate: null,
    expiryStatus: "unknown",
    regOrCertNo: null,
    ratedCapacityTon: null,
    needsPageSelect: false,
    ...overrides,
  };
}

describe("Selective Smart PDF Splitter (2..10p)", () => {
  it("enforces 2..10 page eligibility guard", () => {
    expect(MAX_SMART_SPLIT_PAGES).toBe(10);
    expect(isEligibleForSmartSplit(1)).toBe(false);
    expect(isEligibleForSmartSplit(2)).toBe(true);
    expect(isEligibleForSmartSplit(10)).toBe(true);
    expect(isEligibleForSmartSplit(11)).toBe(false);
    expect(isEligibleForSmartSplit(30)).toBe(false);
  });

  it("groups consecutive pages of the same document and merges continuation null pages", () => {
    const groups = groupConsecutivePagesBySlot([
      { pageNumber: 1, ocr: makeOcr({ suggestedKey: "insurance_cert", docCategoryLabel: "보험가입증명서", expiryDate: null }) },
      { pageNumber: 2, ocr: makeOcr({ suggestedKey: null, docCategoryLabel: "미분류", expiryDate: "2027-06-30", expiryStatus: "valid" }) },
      { pageNumber: 3, ocr: makeOcr({ suggestedKey: "biz_license", docCategoryLabel: "사업자등록증" }) },
      { pageNumber: 4, ocr: makeOcr({ suggestedKey: "vehicle_reg", docCategoryLabel: "차량등록증" }) },
    ]);

    expect(groups).toHaveLength(3);
    expect(groups[0].suggestedKey).toBe("insurance_cert");
    expect(groups[0].pages).toEqual([1, 2]);
    // Harvested expiry from continuation page 2
    expect(groups[0].primaryOcr.expiryDate).toBe("2027-06-30");
    expect(groups[1].suggestedKey).toBe("biz_license");
    expect(groups[1].pages).toEqual([3]);
    expect(groups[2].suggestedKey).toBe("vehicle_reg");
    expect(groups[2].pages).toEqual([4]);
  });

  it("splits a real 3-page PDF into exact child PDFs via pdf-lib", async () => {
    const src = await PDFDocument.create();
    src.addPage([200, 200]);
    src.addPage([200, 200]);
    src.addPage([200, 200]);
    const bytes = await src.save();
    const originalFile = new File([bytes], "bundle.pdf", { type: "application/pdf" });

    const groups = [
      {
        suggestedKey: "insurance_cert",
        docCategoryLabel: "보험가입증명서",
        pages: [1, 2],
        primaryOcr: makeOcr({ suggestedKey: "insurance_cert", docCategoryLabel: "보험가입증명서" }),
      },
      {
        suggestedKey: "biz_license",
        docCategoryLabel: "사업자등록증",
        pages: [3],
        primaryOcr: makeOcr({ suggestedKey: "biz_license", docCategoryLabel: "사업자등록증" }),
      },
    ];

    const children = await splitPdfFileByGroups(originalFile, groups);
    expect(children).toHaveLength(2);
    expect(children[0].file.name).toBe("보험가입증명서_p1-2.pdf");
    expect(children[1].file.name).toBe("사업자등록증_p3.pdf");

    const pdf0 = await PDFDocument.load(await children[0].file.arrayBuffer());
    const pdf1 = await PDFDocument.load(await children[1].file.arrayBuffer());
    expect(pdf0.getPageCount()).toBe(2);
    expect(pdf1.getPageCount()).toBe(1);
  });
});
