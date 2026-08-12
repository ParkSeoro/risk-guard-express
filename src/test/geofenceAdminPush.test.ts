import { describe, expect, it } from "vitest";
import { applyGpsCalibration, parseGpsCalibration } from "@/lib/tracking/gpsCalibration";
import { buildGeofenceAdminPushBody } from "@/lib/tracking/geofenceAdminPush";

describe("geofence admin push — single GPS calibration", () => {
  const cal = parseGpsCalibration({
    d_lat: 0.0002,
    d_lng: -0.0003,
    accuracy_m: 8,
    site_map_id: "m1",
    map_lat: 1,
    map_lng: 2,
    raw_lat: 0,
    raw_lng: 0,
    calibrated_at: "2026-08-12T00:00:00Z",
  });

  it("sends device raw lat/lng to track-location (not map-aligned)", () => {
    const rawLat = 34.76;
    const rawLng = 127.74;
    const calibrated = applyGpsCalibration(rawLat, rawLng, cal);

    // Local zone check would use calibrated; server body must stay raw.
    expect(calibrated.lat).not.toBeCloseTo(rawLat, 8);
    expect(calibrated.lng).not.toBeCloseTo(rawLng, 8);

    const body = buildGeofenceAdminPushBody({
      projectId: "proj-1",
      subject: { worker_id: "w1", worker_name: "테스트" },
      rawLat,
      rawLng,
      accuracyM: 12,
      restrictedZoneId: "zone-1",
    });

    expect(body.lat).toBe(rawLat);
    expect(body.lng).toBe(rawLng);
    expect(body.lat).not.toBe(calibrated.lat);
    expect(body.lng).not.toBe(calibrated.lng);
    expect(body.accuracy_m).toBe(12);
    expect(body.force_restricted_check).toBe(true);
    expect(body.restricted_zone_id).toBe("zone-1");
  });

  it("server-side second apply would double-shift — proves we must not send calibrated", () => {
    const rawLat = 34.76;
    const rawLng = 127.74;
    const once = applyGpsCalibration(rawLat, rawLng, cal);
    const twice = applyGpsCalibration(once.lat, once.lng, cal);
    expect(twice.lat).toBeCloseTo(rawLat + 2 * (cal!.d_lat), 8);
    expect(twice.lng).toBeCloseTo(rawLng + 2 * (cal!.d_lng), 8);
    // Admin push body must equal raw so server lands on `once`, not `twice`.
    const body = buildGeofenceAdminPushBody({
      projectId: "p",
      rawLat,
      rawLng,
      accuracyM: 20,
      restrictedZoneId: "z",
    });
    const serverWouldApply = applyGpsCalibration(body.lat, body.lng, cal);
    expect(serverWouldApply.lat).toBeCloseTo(once.lat, 8);
    expect(serverWouldApply.lng).toBeCloseTo(once.lng, 8);
  });
});
