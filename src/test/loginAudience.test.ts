import { describe, expect, it } from "vitest";
import { initialLoginAudience } from "@/lib/loginAudience";

describe("initialLoginAudience", () => {
  it("opens the manager form when nothing is remembered", () => {
    expect(initialLoginAudience({})).toBe("manager");
    expect(initialLoginAudience({ workerQr: false, hasWorkerPhoneMemory: false })).toBe("manager");
  });

  it("opens the worker form for a registration QR or a saved phone", () => {
    expect(initialLoginAudience({ workerQr: true })).toBe("worker");
    expect(initialLoginAudience({ hasWorkerPhoneMemory: true })).toBe("worker");
  });
});
