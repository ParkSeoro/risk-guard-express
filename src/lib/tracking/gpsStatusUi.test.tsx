import { describe, expect, it } from "vitest";
import { GPS_BLOCK_CHIP, GPS_BLOCK_HINT } from "@/lib/tracking/gpsStatusUi";

describe("GPS header chip copy", () => {
  it("keeps block reasons short enough for the SafeNex header", () => {
    for (const label of Object.values(GPS_BLOCK_CHIP)) {
      expect(label.length).toBeLessThanOrEqual(10);
      expect(label.startsWith("GPS")).toBe(true);
    }
    expect(GPS_BLOCK_CHIP.no_checkin).toBe("GPS 출근 전");
    expect(GPS_BLOCK_HINT.fence_probe_failed).toMatch(/복귀/);
  });
});
