import { describe, expect, it } from "vitest";
import {
  formatGpsFixAgo,
  gpsAgeBucket,
  GPS_BLOCK_REASON_ADMIN,
  GPS_DELAYED_MS,
  GPS_LIVE_MS,
  summarizeGpsHealth,
} from "@/lib/tracking/gpsTrackingHealth";
import { isGpsAccurateEnoughForSiren } from "@/lib/tracking/geofenceLocalAlarm";
import { seoulDayRange } from "@/lib/dailyWorkAck";
import { nextOutsideStreak } from "@/lib/tracking/siteTrackPhase";
import { isInsideResumeFence, SITE_EXIT_STREAK } from "@/lib/tracking/siteTrackBounds";

describe("gps tracking health buckets (F-08)", () => {
  const now = Date.parse("2026-08-18T12:00:00Z");

  it("treats a 4-minute-old ping as live", () => {
    expect(gpsAgeBucket(new Date(now - 4 * 60_000).toISOString(), now)).toBe("live");
  });

  it("treats 5–30 minutes as delayed and older as disconnected", () => {
    expect(gpsAgeBucket(new Date(now - GPS_LIVE_MS - 1).toISOString(), now)).toBe("delayed");
    expect(gpsAgeBucket(new Date(now - GPS_DELAYED_MS - 1).toISOString(), now)).toBe(
      "disconnected",
    );
    expect(gpsAgeBucket(null, now)).toBe("disconnected");
  });

  it("summarizes counts and never exposes coordinates", () => {
    const s = summarizeGpsHealth([
      { bucket: "live" },
      { bucket: "live" },
      { bucket: "delayed" },
      { bucket: "disconnected" },
    ]);
    expect(s).toEqual({ live: 2, delayed: 1, disconnected: 1, total: 4 });
    expect(GPS_BLOCK_REASON_ADMIN.no_checkin).toMatch(/출근/);
    expect(formatGpsFixAgo(null, now)).toBe("수신 없음");
  });

  it("treats a status-only worker (no last_positions) as disconnected", () => {
    expect(gpsAgeBucket(null, now)).toBe("disconnected");
    expect(gpsAgeBucket(undefined, now)).toBe("disconnected");
  });
});

describe("F-14 regressions still hold", () => {
  it("includes a 07:00 KST check-in in today's Seoul window (F-01)", () => {
    const { start, end } = seoulDayRange("2026-08-18");
    const entry = new Date("2026-08-18T07:00:00+09:00").getTime();
    expect(entry).toBeGreaterThanOrEqual(new Date(start).getTime());
    expect(entry).toBeLessThanOrEqual(new Date(end).getTime());
  });

  it("rejects a 300m fix for the danger siren (F-02)", () => {
    expect(isGpsAccurateEnoughForSiren(300)).toBe(false);
    expect(isGpsAccurateEnoughForSiren(12)).toBe(true);
  });

  it("resumes tracking after enough outside samples then an inside fix (F-03)", () => {
    let streak = 0;
    for (let i = 0; i < SITE_EXIT_STREAK; i++) {
      const n = nextOutsideStreak(true, streak);
      streak = n.streak;
      if (i < SITE_EXIT_STREAK - 1) expect(n.suspend).toBe(false);
      else expect(n.suspend).toBe(true);
    }
    const fence = { lat: 37.5, lng: 127.0, radiusM: 500, source: "site_pin" as const };
    expect(isInsideResumeFence(fence, 37.5, 127.0, 15)).toBe(true);
  });
});
