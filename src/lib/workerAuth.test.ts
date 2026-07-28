import { describe, expect, it } from "vitest";
import {
  formatPhoneMask,
  phoneToWorkerEmail,
  workerPhoneSchema,
  workerPinSchema,
  isWorkerVirtualEmail,
} from "@/lib/workerAuth";

describe("workerAuth virtual email", () => {
  it("converts phone digits to @worker.local email for login wrapping", () => {
    expect(phoneToWorkerEmail("010-1234-5678")).toBe("01012345678@worker.local");
    expect(phoneToWorkerEmail("01012345678")).toBe("01012345678@worker.local");
    // loginEmail = `${phoneNumber}@worker.local`
    const phoneNumber = "01098765432";
    const loginEmail = `${phoneNumber}@worker.local`;
    expect(phoneToWorkerEmail(phoneNumber)).toBe(loginEmail);
  });

  it("masks phone input for display", () => {
    expect(formatPhoneMask("01012345678")).toBe("010-1234-5678");
    expect(formatPhoneMask("01012")).toBe("010-12");
  });

  it("validates pin and phone", () => {
    expect(workerPinSchema.safeParse("1234").success).toBe(true);
    expect(workerPinSchema.safeParse("12").success).toBe(false);
    expect(workerPhoneSchema.safeParse("010-1234-5678").success).toBe(true);
    expect(isWorkerVirtualEmail("01012345678@worker.local")).toBe(true);
  });
});
