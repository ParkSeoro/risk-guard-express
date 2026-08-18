import { describe, expect, it } from "vitest";
import { isZoneEventAboutMe } from "@/lib/tracking/zoneEventAboutMe";
import {
  isGpsAccurateEnoughForSiren,
  shouldSuppressLocalSirenOffsite,
} from "@/lib/tracking/geofenceLocalAlarm";
import { SITE_TRACK_EXIT_M, SIREN_MAX_ACCURACY_M } from "@/lib/tracking/siteTrackBounds";

describe("isZoneEventAboutMe", () => {
  it("matches by phone digits", () => {
    expect(
      isZoneEventAboutMe(
        { worker_phone: "010-1234-5678", worker_name: "다른이름" },
        { phone: "01012345678", workerId: "w1" },
      ),
    ).toBe(true);
  });

  it("matches by worker id / qr id", () => {
    expect(
      isZoneEventAboutMe(
        { worker_qr_id: "w1", worker_name: "김현장" },
        { phone: "01099998888", workerId: "w1" },
      ),
    ).toBe(true);
  });

  it("does not match by display name alone", () => {
    expect(
      isZoneEventAboutMe(
        { worker_name: "박서로", worker_phone: "010-1111-2222" },
        { phone: "010-3333-4444", workerId: "w-me" },
      ),
    ).toBe(false);
  });

  it("does not match empty identity", () => {
    expect(isZoneEventAboutMe({ worker_name: "박서로" }, { phone: null, workerId: null })).toBe(
      false,
    );
  });
});

describe("shouldSuppressLocalSirenOffsite", () => {
  const fence = { lat: 34.85, lng: 127.7, radiusM: SITE_TRACK_EXIT_M, source: "site_pin" as const };

  it("does not suppress when no fence is configured", () => {
    expect(
      shouldSuppressLocalSirenOffsite({
        fence: null,
        rawLat: 37.5,
        rawLng: 127.0,
        accuracyM: 10,
      }),
    ).toBe(false);
  });

  it("suppresses a home-scale offset (Seoul vs site)", () => {
    expect(
      shouldSuppressLocalSirenOffsite({
        fence,
        rawLat: 37.5665,
        rawLng: 126.978,
        accuracyM: 12,
      }),
    ).toBe(true);
  });

  it("does not suppress when standing on the site pin", () => {
    expect(
      shouldSuppressLocalSirenOffsite({
        fence,
        rawLat: fence.lat,
        rawLng: fence.lng,
        accuracyM: 12,
      }),
    ).toBe(false);
  });

  it("allows off-site sirens when master alarm-test mode is on", () => {
    expect(
      shouldSuppressLocalSirenOffsite({
        fence,
        rawLat: 37.5665,
        rawLng: 126.978,
        accuracyM: 12,
        allowOffsite: true,
      }),
    ).toBe(false);
  });
});

describe("isGpsAccurateEnoughForSiren (F-02)", () => {
  it("rejects a 300m wakeup blip that would otherwise open the siren", () => {
    expect(isGpsAccurateEnoughForSiren(300)).toBe(false);
    expect(isGpsAccurateEnoughForSiren(undefined)).toBe(false);
  });

  it("accepts a tight fix at the shared open/close threshold", () => {
    expect(isGpsAccurateEnoughForSiren(12)).toBe(true);
    expect(isGpsAccurateEnoughForSiren(SIREN_MAX_ACCURACY_M)).toBe(true);
    expect(isGpsAccurateEnoughForSiren(SIREN_MAX_ACCURACY_M + 1)).toBe(false);
  });
});
