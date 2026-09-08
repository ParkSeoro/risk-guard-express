import { describe, expect, it } from "vitest";
import {
  classifyBulkPhoneHit,
  formatWorkerBulkRowError,
  phonesEligibleForProvision,
} from "@/lib/workerBulk";

describe("phonesEligibleForProvision", () => {
  it("drops OTHER_COMPANY phones so login is not created without a roster row", () => {
    expect(
      phonesEligibleForProvision({
        validDigits: ["01054707056", "01011112222"],
        failedPhones: ["010-5470-7056"],
      }),
    ).toEqual(["01011112222"]);
  });

  it("prefers ok_phones from the upsert when present", () => {
    expect(
      phonesEligibleForProvision({
        validDigits: ["01054707056", "01011112222"],
        okPhones: ["010-1111-2222"],
        failedPhones: ["01054707056"],
      }),
    ).toEqual(["01011112222"]);
  });
});

describe("formatWorkerBulkRowError", () => {
  it("labels a cross-company phone", () => {
    expect(formatWorkerBulkRowError("OTHER_COMPANY")).toBe("다른 회사 소속 전화번호");
  });
});

describe("classifyBulkPhoneHit", () => {
  it("marks another company's roster row as transferable", () => {
    expect(
      classifyBulkPhoneHit(
        {
          worker_id: "w1",
          company_id: "co-other",
          company_name: "청원산기(주)",
          is_active: true,
        },
        "co-jinnam",
        "진남토건(주)",
      ),
    ).toEqual({
      action: "transfer",
      workerId: "w1",
      sourceCompanyId: "co-other",
      sourceCompanyName: "청원산기(주)",
      isActive: true,
    });
  });

  it("updates the same company and claims unlabeled orphans", () => {
    expect(
      classifyBulkPhoneHit(
        { worker_id: "w2", company_id: "co-jinnam", company_name: "진남토건(주)" },
        "co-jinnam",
        "진남토건(주)",
      ),
    ).toEqual({ action: "update" });
    expect(
      classifyBulkPhoneHit(
        { worker_id: "w3", company_id: null, company_name: "" },
        "co-jinnam",
        "진남토건(주)",
      ),
    ).toEqual({ action: "claim" });
  });
});
