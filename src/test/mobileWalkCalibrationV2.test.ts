import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  aggregateGpsSamples,
  fitSimilarityFromControlPoints,
  type WalkControlPoint,
} from "@/lib/tracking/fitAffineFromControlPoints";
import { canCalibrateSiteMap } from "@/lib/tracking/mapCalibrationAccess";
import { metersPerUv } from "@/lib/tracking/imageSpaceGeo";

describe("Mobile Walking GPS Calibration v2 (4-DOF Similarity Fit + Multi-Sample Average + Role Access)", () => {
  describe("fitSimilarityFromControlPoints", () => {
    it("recovers exact rotated 4:3 drone map corners with ~0m RMS and preserves aspect ratio", () => {
      const aspect = 4 / 3;
      const heightM = 150;
      const widthM = heightM * aspect; // 200m
      const lat0 = 37.5;
      const lng0 = 127.0;
      const mPerDegLat = 111_320;
      const mPerDegLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
      const theta = (25 * Math.PI) / 180; // 25° CCW rotation
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      const synth = (id: string, u: number, v: number): WalkControlPoint => {
        const x = u * widthM;
        const y = -v * heightM;
        const E = cosT * x - sinT * y;
        const N = sinT * x + cosT * y;
        return {
          id,
          u,
          v,
          lat: lat0 + N / mPerDegLat,
          lng: lng0 + E / mPerDegLng,
        };
      };

      const pts = [synth("1", 0.1, 0.1), synth("2", 0.9, 0.15), synth("3", 0.2, 0.85)];
      const fit = fitSimilarityFromControlPoints(pts, aspect);
      expect("error" in fit).toBe(false);
      if ("error" in fit) return;

      expect(fit.rmsM).toBeLessThan(0.5);
      expect(fit.widthM).toBeCloseTo(widthM, 0);
      expect(fit.heightM).toBeCloseTo(heightM, 0);

      // Aspect ratio strictly preserved (mu / mv === aspect)
      const { mu, mv } = metersPerUv(fit.corners);
      expect(mu / mv).toBeCloseTo(aspect, 2);
    });

    it("detects a bad 3rd point with REAL non-zero RMS instead of silently reporting 0m like 6-DOF affine", () => {
      const aspect = 4 / 3;
      const lat0 = 37.5;
      const lng0 = 127.0;
      const mPerDegLat = 111_320;
      const mPerDegLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);

      const pts: WalkControlPoint[] = [
        { id: "1", u: 0.1, v: 0.1, lat: lat0, lng: lng0 },
        { id: "2", u: 0.9, v: 0.1, lat: lat0, lng: lng0 + 160 / mPerDegLng },
        // Shift 3rd point 35m east (strong shear/jump!) — 6-DOF affine would report 0m RMS,
        // 4-DOF similarity exposes a real residual!
        { id: "3", u: 0.1, v: 0.9, lat: lat0 - 120 / mPerDegLat, lng: lng0 + 35 / mPerDegLng },
      ];

      const fit = fitSimilarityFromControlPoints(pts, aspect);
      expect("error" in fit).toBe(false);
      if ("error" in fit) return;
      expect(fit.rmsM).toBeGreaterThan(5);
      expect(fit.maxResidualM).toBeGreaterThan(5);
    });

    it("rejects collinear points and huge residual errors", () => {
      const col = fitSimilarityFromControlPoints([
        { id: "1", u: 0.1, v: 0.1, lat: 37.5, lng: 127.0 },
        { id: "2", u: 0.5, v: 0.5, lat: 37.501, lng: 127.001 },
        { id: "3", u: 0.9, v: 0.9, lat: 37.502, lng: 127.002 },
      ]);
      expect("error" in col).toBe(true);
    });
  });

  describe("aggregateGpsSamples", () => {
    it("drops multipath outliers and computes accuracy-weighted average", () => {
      const agg = aggregateGpsSamples([
        { lat: 37.50001, lng: 127.00001, accuracy: 5 },
        { lat: 37.50002, lng: 127.00002, accuracy: 5 },
        { lat: 37.5, lng: 127.0, accuracy: 4 },
        // 80m multipath jump — must be rejected!
        { lat: 37.5008, lng: 127.0008, accuracy: 12 },
        // > 35m low accuracy — must be dropped!
        { lat: 37.502, lng: 127.002, accuracy: 60 },
      ]);
      expect("error" in agg).toBe(false);
      if ("error" in agg) return;
      expect(agg.keptCount).toBe(3);
      expect(agg.lat).toBeCloseTo(37.50001, 4);
      expect(agg.lng).toBeCloseTo(127.00001, 4);
      expect(agg.spreadM).toBeLessThan(5);
    });

    it("rejects bimodal split clusters instead of averaging two distant multipath points", () => {
      const split = aggregateGpsSamples([
        { lat: 37.5, lng: 127.0, accuracy: 5 },
        { lat: 37.5, lng: 127.0, accuracy: 5 },
        { lat: 37.5005, lng: 127.0005, accuracy: 5 },
        { lat: 37.5005, lng: 127.0005, accuracy: 5 },
      ]);
      expect("error" in split).toBe(true);
    });

    it("returns an error when all samples exceed accuracy cap", () => {
      const agg = aggregateGpsSamples([{ lat: 37.5, lng: 127.0, accuracy: 55 }], 35);
      expect("error" in agg).toBe(true);
    });
  });

  describe("canCalibrateSiteMap access policy", () => {
    it("allows master and non-contractor project_admin / safety_manager only", () => {
      expect(canCalibrateSiteMap({ isMaster: true, role: "worker", companyType: "contractor" })).toBe(true);
      expect(canCalibrateSiteMap({ isMaster: false, role: "project_admin", companyType: "client" })).toBe(true);
      expect(canCalibrateSiteMap({ isMaster: false, role: "project_admin", companyType: "gc" })).toBe(true);
      expect(canCalibrateSiteMap({ isMaster: false, role: "safety_manager", companyType: "gc" })).toBe(true);
      expect(canCalibrateSiteMap({ isMaster: false, role: "safety_manager", companyType: "client" })).toBe(true);

      // Blocked roles, contractor/subcontractor variants, and missing companyType
      expect(canCalibrateSiteMap({ isMaster: false, role: "safety_manager", companyType: "contractor" })).toBe(false);
      expect(canCalibrateSiteMap({ isMaster: false, role: "safety_manager", companyType: "하청" })).toBe(false);
      expect(canCalibrateSiteMap({ isMaster: false, role: "safety_manager", companyType: null })).toBe(false);
      expect(canCalibrateSiteMap({ isMaster: false, role: "project_admin", companyType: "vendor" })).toBe(false);
      expect(canCalibrateSiteMap({ isMaster: false, role: "site_manager", companyType: "gc" })).toBe(false);
      expect(canCalibrateSiteMap({ isMaster: false, role: "site_supervisor", companyType: "gc" })).toBe(false);
      expect(canCalibrateSiteMap({ isMaster: false, role: "worker", companyType: "gc" })).toBe(false);
      expect(canCalibrateSiteMap({ isMaster: false, role: "viewer", companyType: "client" })).toBe(false);
    });

    it("wires SQL RPCs, hardening migration, ZoomableSiteMapImage double-tap fix, and docs/access-policy.md", () => {
      const sql = readFileSync(
        "supabase/migrations/20261123081000_site_map_calibration_rpcs.sql",
        "utf8",
      ).replace(/\r\n/g, "\n");
      const hardSql = readFileSync(
        "supabase/migrations/20261123084500_site_map_calibration_rpcs_hardening.sql",
        "utf8",
      ).replace(/\r\n/g, "\n");
      const calSrc = readFileSync("src/pages/MobileMapCalibration.tsx", "utf8").replace(/\r\n/g, "\n");
      const moreSrc = readFileSync("src/pages/MobileMore.tsx", "utf8").replace(/\r\n/g, "\n");
      const docSrc = readFileSync("docs/access-policy.md", "utf8").replace(/\r\n/g, "\n");

      expect(sql).toContain("public.can_calibrate_site_map");
      expect(sql).toContain("public.save_site_map_georef");
      expect(sql).toContain("public.save_project_gps_calibration");
      expect(hardSql).toContain("REVOKE ALL ON FUNCTION public.can_calibrate_site_map");
      expect(hardSql).toContain("GPS_CALIBRATION_OFFSET_TOO_LARGE");
      expect(calSrc).toContain("fitSimilarityFromControlPoints");
      expect(calSrc).toContain("aggregateGpsSamples");
      expect(calSrc).toContain("save_site_map_georef");
      expect(calSrc).toContain("save_project_gps_calibration");
      expect(moreSrc).toContain("canCalibrateSiteMap");
      expect(docSrc).toContain("save_site_map_georef");
    });
  });
});
