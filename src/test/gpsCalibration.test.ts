import { describe, expect, it } from "vitest";
import {
  applyGpsCalibration,
  clearGpsCalibrationCache,
  computeGpsOffset,
  fetchProjectGpsCalibration,
  GPS_CAL_MAX_ACCURACY_M,
  GPS_CAL_MAX_OFFSET_M,
  offsetMagnitudeM,
  parseGpsCalibration,
} from "@/lib/tracking/gpsCalibration";

describe("gpsCalibration", () => {
  it("computes map − raw offset", () => {
    const o = computeGpsOffset({ lat: 37.5, lng: 127.1 }, { lat: 37.5001, lng: 127.0999 });
    expect(o.d_lat).toBeCloseTo(-0.0001, 8);
    expect(o.d_lng).toBeCloseTo(0.0001, 8);
  });

  it("applies offset to raw fix", () => {
    const cal = parseGpsCalibration({
      d_lat: 0.0001,
      d_lng: -0.0002,
      accuracy_m: 12,
      site_map_id: "m1",
      map_lat: 1,
      map_lng: 2,
      raw_lat: 0,
      raw_lng: 0,
      calibrated_at: "2026-08-04T00:00:00Z",
    });
    const r = applyGpsCalibration(37.0, 127.0, cal);
    expect(r.calibrated).toBe(true);
    expect(r.lat).toBeCloseTo(37.0001, 8);
    expect(r.lng).toBeCloseTo(126.9998, 8);
  });

  it("ignores null / zero calibration", () => {
    expect(applyGpsCalibration(1, 2, null).calibrated).toBe(false);
    expect(parseGpsCalibration({ d_lat: 0, d_lng: 0 })).toBeNull();
  });

  it("offset magnitude gates are sane", () => {
    expect(GPS_CAL_MAX_ACCURACY_M).toBeLessThanOrEqual(40);
    expect(GPS_CAL_MAX_OFFSET_M).toBeGreaterThan(50);
    const m = offsetMagnitudeM(0.001, 0, 37.5); // ~111m
    expect(m).toBeGreaterThan(100);
    expect(m).toBeLessThan(120);
  });

  it("busts the 60s cache on clearGpsCalibrationCache (F-13)", async () => {
    let n = 0;
    const raw = {
      d_lat: 0.0001,
      d_lng: 0,
      accuracy_m: 12,
      site_map_id: "m1",
      map_lat: 1,
      map_lng: 2,
      raw_lat: 0,
      raw_lng: 0,
      calibrated_at: "2026-08-18T00:00:00Z",
    };
    const fetcher = async () => {
      n += 1;
      return raw;
    };
    const a = await fetchProjectGpsCalibration("p-cache", fetcher);
    const b = await fetchProjectGpsCalibration("p-cache", fetcher);
    expect(a?.d_lat).toBe(0.0001);
    expect(b?.d_lat).toBe(0.0001);
    expect(n).toBe(1);
    clearGpsCalibrationCache("p-cache");
    await fetchProjectGpsCalibration("p-cache", fetcher);
    expect(n).toBe(2);
  });
});
