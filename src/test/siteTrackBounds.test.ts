import { describe, expect, it } from "vitest";
import {
  SITE_EXIT_STREAK,
  SITE_TRACK_EXIT_M,
  SITE_TRACK_RESUME_M,
} from "@/lib/tracking/siteTrackBounds";

describe("siteTrackBounds", () => {
  it("exit radius is 100m with resume hysteresis", () => {
    expect(SITE_TRACK_EXIT_M).toBe(100);
    expect(SITE_TRACK_RESUME_M).toBeLessThan(SITE_TRACK_EXIT_M);
    expect(SITE_EXIT_STREAK).toBeGreaterThanOrEqual(2);
  });
});
