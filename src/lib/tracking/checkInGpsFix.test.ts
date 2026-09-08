import { describe, expect, it } from "vitest";
import { pickCheckInGpsFix, rawCheckInFix } from "@/lib/tracking/checkInGpsFix";

describe("rawCheckInFix", () => {
  it("prefers raw WGS84 over map-calibrated lat/lng", () => {
    expect(
      rawCheckInFix({
        lat: 34.86,
        lng: 127.71,
        raw_lat: 34.8523,
        raw_lng: 127.7004,
        accuracy: 12,
        at: 1,
      }),
    ).toEqual({ lat: 34.8523, lng: 127.7004, accuracy: 12, at: 1 });
  });

  it("falls back to lat/lng when raw is missing", () => {
    expect(rawCheckInFix({ lat: 34.85, lng: 127.7, accuracy: 20 })).toEqual({
      lat: 34.85,
      lng: 127.7,
      accuracy: 20,
      at: undefined,
    });
  });
});

describe("pickCheckInGpsFix", () => {
  it("keeps the more accurate sample", () => {
    const coarse = { lat: 1, lng: 1, accuracy: 80, at: 9 };
    const fine = { lat: 2, lng: 2, accuracy: 15, at: 1 };
    expect(pickCheckInGpsFix(coarse, fine)).toEqual(fine);
  });

  it("keeps the newer sample when accuracy ties", () => {
    const older = { lat: 1, lng: 1, accuracy: 20, at: 1 };
    const newer = { lat: 2, lng: 2, accuracy: 20, at: 2 };
    expect(pickCheckInGpsFix(older, newer)).toEqual(newer);
  });
});
