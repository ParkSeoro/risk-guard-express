import { describe, expect, it } from "vitest";
import {
  classifyStorageCircuitError,
  resolvePurgeMaxFiles,
  restoreProbeDue,
} from "@/lib/storagePurgePolicy";

describe("storagePurgePolicy", () => {
  it("keeps canary 5 until two success nights then 15", () => {
    expect(resolvePurgeMaxFiles({ consecutiveCanarySuccessNights: 0 })).toBe(5);
    expect(resolvePurgeMaxFiles({ consecutiveCanarySuccessNights: 1 })).toBe(5);
    expect(resolvePurgeMaxFiles({ consecutiveCanarySuccessNights: 2 })).toBe(15);
    expect(resolvePurgeMaxFiles({ consecutiveCanarySuccessNights: 5 })).toBe(15);
  });

  it("classifies fatal vs transient circuit errors", () => {
    expect(classifyStorageCircuitError("invalid_grant")).toBe("fatal");
    expect(classifyStorageCircuitError("GDRIVE_AUTH_ERROR:401")).toBe("fatal");
    expect(classifyStorageCircuitError("checksum_mismatch")).toBe("fatal");
    expect(classifyStorageCircuitError("quota 90.1%")).toBe("fatal");
    expect(classifyStorageCircuitError("HTTP 503 timeout")).toBe("transient");
    expect(classifyStorageCircuitError("quota 81% warn")).toBe("transient");
    expect(classifyStorageCircuitError("")).toBe("none");
  });

  it("schedules restore probe after 6 days", () => {
    const now = Date.parse("2026-11-20T02:00:00Z");
    expect(restoreProbeDue(null, now)).toBe(true);
    expect(restoreProbeDue("2026-11-19T02:00:00Z", now)).toBe(false);
    expect(restoreProbeDue("2026-11-13T02:00:00Z", now)).toBe(true);
  });
});
