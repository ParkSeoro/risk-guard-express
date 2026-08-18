import { describe, expect, it } from "vitest";
import { nextOutsideStreak } from "@/lib/tracking/siteTrackPhase";
import { SITE_EXIT_STREAK, SITE_RESUME_POLL_MS } from "@/lib/tracking/siteTrackBounds";
import { isInsideResumeFence } from "@/lib/tracking/siteTrackBounds";

describe("site track phase (F-03)", () => {
  it("suspends only after consecutive outside samples", () => {
    let streak = 0;
    for (let i = 0; i < SITE_EXIT_STREAK - 1; i++) {
      const n = nextOutsideStreak(true, streak);
      expect(n.suspend).toBe(false);
      streak = n.streak;
    }
    expect(nextOutsideStreak(true, streak).suspend).toBe(true);
  });

  it("resets the exit streak when back inside", () => {
    expect(nextOutsideStreak(false, 4)).toEqual({ streak: 0, suspend: false });
  });

  it("resumes when raw GPS is inside the tracking fence", () => {
    const fence = { lat: 37.5, lng: 127.0, radiusM: 500, source: "site_pin" as const };
    expect(isInsideResumeFence(fence, 37.5, 127.0, 15)).toBe(true);
    expect(isInsideResumeFence(fence, 37.51, 127.0, 15)).toBe(false);
  });

  it("uses a 5-minute off-site probe, not a continuous watch", () => {
    expect(SITE_RESUME_POLL_MS).toBe(5 * 60_000);
  });
});
