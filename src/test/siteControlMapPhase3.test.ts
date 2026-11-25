import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  aiEstimateToGeoCorners,
  buildSatelliteSearchBbox,
} from "@/lib/map/aiAlignMath";
import { evaluateMapCalibrationHealth } from "@/lib/map/mapCalibrationSafety";
import { cornersToPersistPayload } from "@/lib/mapBounds";

describe("SiteControlMap Phase 3 — Server-side AI satellite ↔ drone 4-DOF draft alignment", () => {
  it("builds symmetric WGS-84 search bbox around site center", () => {
    const bbox = buildSatelliteSearchBbox(34.8125, 127.655, 350);
    expect((bbox.north + bbox.south) / 2).toBeCloseTo(34.8125, 6);
    expect((bbox.east + bbox.west) / 2).toBeCloseTo(127.655, 6);
    expect(bbox.north - bbox.south).toBeGreaterThan(0.005);
    expect(bbox.east - bbox.west).toBeGreaterThan(0.006);
  });

  it("converts AI 4-DOF estimate into aspect-ratio-locked, zero-skew GeoCorners", () => {
    const bbox = buildSatelliteSearchBbox(37.5, 127.0, 400);
    const corners = aiEstimateToGeoCorners({
      bbox,
      estimate: {
        center_x_norm: 0.55,
        center_y_norm: 0.45,
        width_frac: 0.5,
        rotation_deg: 25,
      },
      aspectRatio: 16 / 9,
    });

    const cosLat = Math.cos((37.5 * Math.PI) / 180);
    const vx = (corners.tr.lng - corners.tl.lng) * cosLat;
    const vy = corners.tr.lat - corners.tl.lat;
    const wx = (corners.bl.lng - corners.tl.lng) * cosLat;
    const wy = corners.bl.lat - corners.tl.lat;

    // 90° orthogonality (zero shear/skew)
    expect(Math.abs(vx * wx + vy * wy)).toBeLessThan(1e-9);
    // Aspect ratio preserved
    const width = Math.hypot(vx, vy);
    const height = Math.hypot(wx, wy);
    expect(width / height).toBeCloseTo(16 / 9, 2);
  });

  it("clamps extreme out-of-range AI parameters safely", () => {
    const bbox = buildSatelliteSearchBbox(37.5, 127.0, 350);
    const corners = aiEstimateToGeoCorners({
      bbox,
      estimate: {
        center_x_norm: 5.0,
        center_y_norm: -3.0,
        width_frac: 99,
        rotation_deg: 720,
      },
      aspectRatio: 1,
    });
    expect(corners.tl.lat).toBeLessThan(38);
    expect(corners.tl.lat).toBeGreaterThan(37);
  });

  it("labels ai-draft source as yellow (unverified until walking calibration)", () => {
    const bbox = buildSatelliteSearchBbox(37.5, 127.0, 350);
    const corners = aiEstimateToGeoCorners({
      bbox,
      estimate: { center_x_norm: 0.5, center_y_norm: 0.5, width_frac: 0.4, rotation_deg: 0 },
    });
    const payload = cornersToPersistPayload(corners, 0.85, { source: "ai-draft" });
    const health = evaluateMapCalibrationHealth({ ...payload, image_url: "https://example.com/a.jpg" });
    expect(health.status).toBe("yellow");
    expect(health.detail).toContain("AI 위성 비교 초안");
  });

  it("wires align-site-map-ai Edge Function with internal auth + preview-only UX", () => {
    const fnSrc = readFileSync("supabase/functions/align-site-map-ai/index.ts", "utf8");
    const cfgSrc = readFileSync("supabase/config.toml", "utf8");
    const scmSrc = readFileSync("src/pages/SiteControlMap.tsx", "utf8");

    expect(fnSrc).toContain("userClient.auth.getUser()");
    expect(fnSrc).toContain("isAllowedDroneUrl");
    expect(cfgSrc).toContain("[functions.align-site-map-ai]");
    expect(scmSrc).toContain('invoke("align-site-map-ai"');
    expect(scmSrc).toContain("applyAiDraftPreview");
    expect(scmSrc).toContain("discardAiDraftPreview");
  });
});
