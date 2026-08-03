import { describe, expect, it } from "vitest";
import { workerPinFromPhone } from "@/lib/workerCredentials";

describe("workerPinFromPhone", () => {
  it("uses last 4 digits of phone", () => {
    expect(workerPinFromPhone("010-1234-5678")).toBe("5678");
    expect(workerPinFromPhone("01012345678")).toBe("5678");
  });

  it("returns null when too short", () => {
    expect(workerPinFromPhone("123")).toBeNull();
    expect(workerPinFromPhone("")).toBeNull();
  });
});
