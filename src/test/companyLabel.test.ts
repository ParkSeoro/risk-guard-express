import { describe, expect, it } from "vitest";
import { isClaimableOrphanWorker, normalizeCompanyLabel } from "@/lib/companyLabel";

describe("normalizeCompanyLabel", () => {
  it("treats corporate suffixes as the same company (any firm)", () => {
    expect(normalizeCompanyLabel("알파산업㈜")).toBe("알파산업");
    expect(normalizeCompanyLabel("알파산업(주)")).toBe("알파산업");
    expect(normalizeCompanyLabel("알파산업 (주)")).toBe("알파산업");
    expect(normalizeCompanyLabel("Beta Eng. (주)")).toBe("betaeng");
    expect(normalizeCompanyLabel("주식회사 감마건설")).toBe("감마건설");
  });
});

describe("isClaimableOrphanWorker", () => {
  it("matches orphan by normalized company name for any firm", () => {
    expect(
      isClaimableOrphanWorker(
        { company_id: null, company_name: "델타설비㈜" },
        "uuid-a",
        "델타설비(주)",
      ),
    ).toBe(true);
    expect(
      isClaimableOrphanWorker(
        { company_id: null, company_name: "Epsilon Corp" },
        "uuid-b",
        "epsilon corp",
      ),
    ).toBe(true);
  });

  it("does not match a different company orphan", () => {
    expect(
      isClaimableOrphanWorker(
        { company_id: null, company_name: "정엔지니어링㈜" },
        "uuid-a",
        "알파산업(주)",
      ),
    ).toBe(false);
  });

  it("allows unlabeled orphans to any scoped company", () => {
    expect(
      isClaimableOrphanWorker(
        { company_id: null, company_name: "" },
        "uuid-a",
        "아무회사",
      ),
    ).toBe(true);
  });

  it("keeps own company_id rows", () => {
    expect(
      isClaimableOrphanWorker(
        { company_id: "uuid-a", company_name: "X" },
        "uuid-a",
        "X",
      ),
    ).toBe(true);
  });

  it("hides other company_id rows", () => {
    expect(
      isClaimableOrphanWorker(
        { company_id: "uuid-b", company_name: "Y" },
        "uuid-a",
        "X",
      ),
    ).toBe(false);
  });
});
