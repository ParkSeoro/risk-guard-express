import { describe, expect, it } from "vitest";
import { formatWorkerBulkRowError, phonesEligibleForProvision } from "@/lib/workerBulk";

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
