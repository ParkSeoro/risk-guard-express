import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildInitialCornersFromSeed,
  parseJpegExifGps,
} from "@/lib/map/droneExif";
import {
  alignCornersFromTwoLandmarks,
  describeGpsCalibrationGuard,
  evaluateMapCalibrationHealth,
  simulateSpotAttendanceImpact,
} from "@/lib/map/mapCalibrationSafety";
import {
  cornersToPersistPayload,
  parseGeoTransform,
  type GeoCorners,
} from "@/lib/mapBounds";
import type { SiteBoundary } from "@/lib/tracking/siteBoundary";

/** Build a minimal valid JPEG with APP1 Exif (II little-endian) + GPS IFD + optional DJI XMP. */
function buildSyntheticDroneJpeg(opts: {
  latDeg: number;
  latMin: number;
  latSec: number;
  lngDeg: number;
  lngMin: number;
  lngSec: number;
  djiYaw?: number;
  djiRelAlt?: number;
}): Uint8Array {
  // TIFF layout inside APP1 payload (after "Exif\0\0"):
  // 0..7: TIFF header ("II", 42, ifd0Offset=8)
  // 8..25: IFD0 (1 entry: tag 0x8825 -> gpsIfdOffset=26, nextIfd=0)
  // 26..89: GPS IFD (5 entries: LatRef, Lat, LngRef, Lng, Alt -> nextIfd=0)
  // 90..113: Lat DMS (3 rationals = 24 bytes)
  // 114..137: Lng DMS (3 rationals = 24 bytes)
  // 138..145: Alt (1 rational = 8 bytes)
  const tiffLen = 146;
  const exifPayloadLen = 6 + tiffLen; // "Exif\0\0" + TIFF
  const xmpStr =
    opts.djiYaw != null || opts.djiRelAlt != null
      ? `http://ns.adobe.com/xap/1.0/\0<rdf:Description ${
          opts.djiYaw != null ? `drone-dji:GimbalYawDegree="${opts.djiYaw}" ` : ""
        }${
          opts.djiRelAlt != null ? `drone-dji:RelativeAltitude="${opts.djiRelAlt}" ` : ""
        }/>`
      : "";
  const xmpBytes = new TextEncoder().encode(xmpStr);

  const totalLen =
    2 + // SOI
    (4 + exifPayloadLen) + // APP1 Exif
    (xmpBytes.length ? 4 + xmpBytes.length : 0) + // APP1 XMP
    2; // EOI

  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);
  let pos = 0;

  // SOI
  buf[pos++] = 0xff;
  buf[pos++] = 0xd8;

  // APP1 Exif
  buf[pos++] = 0xff;
  buf[pos++] = 0xe1;
  view.setUint16(pos, exifPayloadLen + 2, false);
  pos += 2;
  // "Exif\0\0"
  buf.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], pos);
  pos += 6;

  const tiffStart = pos;
  // "II" + 42 + IFD0 offset 8
  buf[tiffStart] = 0x49;
  buf[tiffStart + 1] = 0x49;
  view.setUint16(tiffStart + 2, 42, true);
  view.setUint32(tiffStart + 4, 8, true);

  // IFD0 at +8: 1 entry (0x8825 -> 26)
  view.setUint16(tiffStart + 8, 1, true);
  view.setUint16(tiffStart + 10, 0x8825, true);
  view.setUint16(tiffStart + 12, 4, true); // LONG
  view.setUint32(tiffStart + 14, 1, true);
  view.setUint32(tiffStart + 18, 26, true);
  view.setUint32(tiffStart + 22, 0, true); // next IFD

  // GPS IFD at +26: 5 entries
  const gpsStart = tiffStart + 26;
  view.setUint16(gpsStart, 5, true);
  let e = gpsStart + 2;

  // 1) GPSLatitudeRef = "N"
  view.setUint16(e, 0x0001, true);
  view.setUint16(e + 2, 2, true);
  view.setUint32(e + 4, 2, true);
  buf[e + 8] = "N".charCodeAt(0);
  e += 12;

  // 2) GPSLatitude -> offset 90
  view.setUint16(e, 0x0002, true);
  view.setUint16(e + 2, 5, true);
  view.setUint32(e + 4, 3, true);
  view.setUint32(e + 8, 90, true);
  e += 12;

  // 3) GPSLongitudeRef = "E"
  view.setUint16(e, 0x0003, true);
  view.setUint16(e + 2, 2, true);
  view.setUint32(e + 4, 2, true);
  buf[e + 8] = "E".charCodeAt(0);
  e += 12;

  // 4) GPSLongitude -> offset 114
  view.setUint16(e, 0x0004, true);
  view.setUint16(e + 2, 5, true);
  view.setUint32(e + 4, 3, true);
  view.setUint32(e + 8, 114, true);
  e += 12;

  // 5) GPSAltitude -> offset 138
  view.setUint16(e, 0x0006, true);
  view.setUint16(e + 2, 5, true);
  view.setUint32(e + 4, 1, true);
  view.setUint32(e + 8, 138, true);
  e += 12;

  view.setUint32(e, 0, true); // next GPS IFD

  const writeRat = (relOff: number, num: number, den: number) => {
    view.setUint32(tiffStart + relOff, num, true);
    view.setUint32(tiffStart + relOff + 4, den, true);
  };
  writeRat(90, opts.latDeg, 1);
  writeRat(98, opts.latMin, 1);
  writeRat(106, Math.round(opts.latSec * 100), 100);

  writeRat(114, opts.lngDeg, 1);
  writeRat(122, opts.lngMin, 1);
  writeRat(130, Math.round(opts.lngSec * 100), 100);

  writeRat(138, 120, 1);

  pos = tiffStart + tiffLen;

  if (xmpBytes.length) {
    buf[pos++] = 0xff;
    buf[pos++] = 0xe1;
    view.setUint16(pos, xmpBytes.length + 2, false);
    pos += 2;
    buf.set(xmpBytes, pos);
    pos += xmpBytes.length;
  }

  // EOI
  buf[pos++] = 0xff;
  buf[pos++] = 0xd9;
  return buf;
}

describe("SiteControlMap Phase 1 — EXIF seed, 4-DOF 2-point alignment, and attendance guards", () => {
  it("extracts GPS lat/lng + DJI XMP yaw & relative altitude from JPEG bytes", () => {
    const jpg = buildSyntheticDroneJpeg({
      latDeg: 34,
      latMin: 48,
      latSec: 45,
      lngDeg: 127,
      lngMin: 39,
      lngSec: 18,
      djiYaw: 32.5,
      djiRelAlt: 100,
    });
    const meta = parseJpegExifGps(jpg);
    expect(meta).not.toBeNull();
    expect(meta!.lat).toBeCloseTo(34 + 48 / 60 + 45 / 3600, 5);
    expect(meta!.lng).toBeCloseTo(127 + 39 / 60 + 18 / 3600, 5);
    expect(meta!.altitudeM).toBeCloseTo(120, 1);
    expect(meta!.relativeAltitudeM).toBeCloseTo(100, 1);
    expect(meta!.yawDeg).toBeCloseTo(32.5, 1);
  });

  it("returns null for non-JPEG or empty buffers", () => {
    expect(parseJpegExifGps(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(parseJpegExifGps(new Uint8Array())).toBeNull();
  });

  it("builds aspect-ratio-preserving initial GeoCorners from seed", () => {
    const c = buildInitialCornersFromSeed({
      center: { lat: 34.8125, lng: 127.655 },
      aspectRatio: 16 / 9,
      relativeAltitudeM: 120,
    });
    const cosLat = Math.cos((34.8125 * Math.PI) / 180);
    const widthM = (c.tr.lng - c.tl.lng) * 111_320 * cosLat;
    const heightM = (c.tl.lat - c.bl.lat) * 111_320;
    expect(widthM / heightM).toBeCloseTo(16 / 9, 2);
    expect(widthM).toBeGreaterThan(150);
  });

  it("aligns corners via 4-DOF 2-point similarity transform with zero skew", () => {
    const base = buildInitialCornersFromSeed({
      center: { lat: 37.5, lng: 127.0 },
      aspectRatio: 1.5,
      halfWidthM: 100,
    });
    // Map TL -> shifted +0.001 lat, +0.001 lng; TR -> shifted + rotated/scaled
    const p1Img = base.tl;
    const p2Img = base.tr;
    const p1Sat = { lat: base.tl.lat + 0.001, lng: base.tl.lng + 0.001 };
    const p2Sat = {
      lat: p1Sat.lat,
      lng: p1Sat.lng + (base.tr.lng - base.tl.lng) * 1.25,
    };

    const aligned = alignCornersFromTwoLandmarks(base, p1Img, p1Sat, p2Img, p2Sat);
    expect("error" in aligned).toBe(false);
    if (!("error" in aligned)) {
      expect(aligned.tl.lat).toBeCloseTo(p1Sat.lat, 6);
      expect(aligned.tl.lng).toBeCloseTo(p1Sat.lng, 6);
      expect(aligned.tr.lat).toBeCloseTo(p2Sat.lat, 6);
      expect(aligned.tr.lng).toBeCloseTo(p2Sat.lng, 6);
      // Orthogonality check: dot product of (TR - TL) and (BL - TL) in metric space ≈ 0
      const cosLat = Math.cos((37.5 * Math.PI) / 180);
      const vx = (aligned.tr.lng - aligned.tl.lng) * cosLat;
      const vy = aligned.tr.lat - aligned.tl.lat;
      const wx = (aligned.bl.lng - aligned.tl.lng) * cosLat;
      const wy = aligned.bl.lat - aligned.tl.lat;
      expect(Math.abs(vx * wx + vy * wy)).toBeLessThan(1e-10);
    }
  });

  it("rejects too-close landmark picks in 2-point alignment", () => {
    const base = buildInitialCornersFromSeed({ center: { lat: 37.5, lng: 127.0 } });
    const res = alignCornersFromTwoLandmarks(
      base,
      { lat: 37.5, lng: 127.0 },
      { lat: 37.5, lng: 127.0 },
      { lat: 37.500001, lng: 127.0 },
      { lat: 37.501, lng: 127.0 },
    );
    expect("error" in res).toBe(true);
  });

  it("evaluates calibration traffic-light status accurately", () => {
    const corners: GeoCorners = buildInitialCornersFromSeed({ center: { lat: 37.5, lng: 127.0 } });
    const walkPayload = cornersToPersistPayload(corners, 0.85, { source: "walk" });
    const exifPayload = cornersToPersistPayload(corners, 0.85, { source: "exif" });

    expect(
      evaluateMapCalibrationHealth({ ...walkPayload, image_url: "https://example.com/a.jpg" }).status,
    ).toBe("green");
    expect(
      evaluateMapCalibrationHealth({ ...exifPayload, image_url: "https://example.com/a.jpg" }).status,
    ).toBe("yellow");
    expect(
      evaluateMapCalibrationHealth({
        geo_anchor_nw_lat: null,
        geo_anchor_nw_lng: null,
        geo_anchor_se_lat: null,
        geo_anchor_se_lng: null,
        image_url: "https://example.com/a.jpg",
      }).status,
    ).toBe("red");
  });

  it("persists and parses prev corners snapshot for 1-click rollback", () => {
    const prev = buildInitialCornersFromSeed({ center: { lat: 37.5, lng: 127.0 } });
    const next = buildInitialCornersFromSeed({ center: { lat: 37.501, lng: 127.001 } });
    const payload = cornersToPersistPayload(next, 0.85, { source: "two-point", prev });
    const parsed = parseGeoTransform(payload.geo_transform);
    expect(parsed?.source).toBe("two-point");
    expect(parsed?.prev?.tl.lat).toBeCloseTo(prev.tl.lat, 6);
  });

  it("simulates attendance inclusion rate and flags <50% as danger", () => {
    const spot: SiteBoundary = {
      id: "spot-1",
      project_id: "proj-1",
      name: "1공구",
      geometry_type: "radius",
      geo_polygon: null,
      center_lat: 37.5,
      center_lng: 127.0,
      radius_m: 150,
      buffer_m: 150,
    };

    const safe = simulateSpotAttendanceImpact({
      candidateSpots: [spot],
      workers: [
        { lat: 37.5, lng: 127.0, accuracy_m: 10 },
        { lat: 37.5005, lng: 127.0005, accuracy_m: 10 },
      ],
    });
    expect(safe.inclusionPct).toBe(100);
    expect(safe.severity).toBe("safe");

    const danger = simulateSpotAttendanceImpact({
      candidateSpots: [spot],
      workers: [
        { lat: 37.5, lng: 127.0, accuracy_m: 10 },
        { lat: 37.52, lng: 127.02, accuracy_m: 10 },
        { lat: 37.53, lng: 127.03, accuracy_m: 10 },
      ],
    });
    expect(danger.included).toBe(1);
    expect(danger.excluded).toBe(2);
    expect(danger.inclusionPct).toBe(33);
    expect(danger.severity).toBe("danger");
  });

  it("guards SiteControlMap.tsx against implicit gps_calibration wipe and exposes Phase 1 controls", () => {
    const src = readFileSync("src/pages/SiteControlMap.tsx", "utf8");
    // Must NEVER silently wipe projects.gps_calibration on overlay save
    expect(src).not.toContain(".update({ gps_calibration: null");
    // Must hide TL/TR/BL handles behind showLegacyCornerHandles toggle
    expect(src).toContain("visible={showLegacyCornerHandles && !twoPointActive}");
    // Must wire lifecycle & safety features
    expect(src).toContain("onReplaceDroneImage");
    expect(src).toContain("onRenameMap");
    expect(src).toContain("onDeleteMap");
    expect(src).toContain("onRollbackGeoref");
    expect(src).toContain("simulateSpotAttendanceImpact");
    expect(src).toContain("MobileWalkQrDialog");

    const guard = describeGpsCalibrationGuard(
      { d_lat: 0.0001, d_lng: 0, map_lat: 37.5, map_lng: 127.0, raw_lat: 37.4999, raw_lng: 127.0 },
      2,
    );
    expect(guard.hasCalibration).toBe(true);
    expect(guard.keepRecommended).toBe(true);
  });
});
