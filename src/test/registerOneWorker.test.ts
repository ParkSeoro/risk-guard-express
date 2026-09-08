import { describe, expect, it } from "vitest";
import { formatWorkerPhoneInput, workerLoginPreview } from "@/lib/registerOneWorker";

describe("workerLoginPreview", () => {
  it("uses the phone as id and the last 4 digits as the password", () => {
    expect(workerLoginPreview("010-5470-7056")).toEqual({
      loginId: "01054707056",
      password: "7056",
    });
    expect(workerLoginPreview("01012345678")).toEqual({
      loginId: "01012345678",
      password: "5678",
    });
  });

  it("stays empty until a full mobile number is typed", () => {
    expect(workerLoginPreview("010-547")).toBeNull();
  });
});

describe("formatWorkerPhoneInput", () => {
  it("masks digits as 010-XXXX-XXXX", () => {
    expect(formatWorkerPhoneInput("01054707056")).toBe("010-5470-7056");
  });
});
