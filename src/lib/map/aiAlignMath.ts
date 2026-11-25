/**
 * Pure-TS deterministic math for Phase 3 AI Satellite ↔ Drone 4-DOF draft alignment.
 * Converts normalized AI alignment parameters + exact satellite WGS-84 bbox into
 * aspect-ratio-locked, zero-skew GeoCorners (TL/TR/BL).
 */
import { rotateCorners, type GeoCorners } from "@/lib/mapBounds";

export type SatelliteBbox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type AiAlignEstimate = {
  center_x_norm: number;
  center_y_norm: number;
  width_frac: number;
  rotation_deg: number;
  confidence: "high" | "medium" | "low";
  landmarks_matched: string[];
  reason: string;
};

export type AiAlignResponse = {
  corners: GeoCorners;
  bbox: SatelliteBbox;
  satellite_source: "vworld" | "esri";
  estimate: AiAlignEstimate;
};

/**
 * Compute a square-ish metric WGS-84 bounding box centered on (lat, lng) with half-size `halfExtentM`.
 */
export function buildSatelliteSearchBbox(
  centerLat: number,
  centerLng: number,
  halfExtentM = 350,
): SatelliteBbox {
  const clampedHalf = Math.min(1200, Math.max(120, halfExtentM));
  const metersPerDegLat = 111_320;
  const cosLat = Math.max(Math.cos((centerLat * Math.PI) / 180), 0.1);
  const metersPerDegLng = metersPerDegLat * cosLat;
  const dLat = clampedHalf / metersPerDegLat;
  const dLng = clampedHalf / metersPerDegLng;
  return {
    west: centerLng - dLng,
    south: centerLat - dLat,
    east: centerLng + dLng,
    north: centerLat + dLat,
  };
}

/**
 * Convert AI 4-DOF normalized parameters within `bbox` into aspect-preserving GeoCorners.
 * Guarantees zero shear/skew and clamps all parameters to sane bounds.
 */
export function aiEstimateToGeoCorners(opts: {
  bbox: SatelliteBbox;
  estimate: Pick<AiAlignEstimate, "center_x_norm" | "center_y_norm" | "width_frac" | "rotation_deg">;
  aspectRatio?: number;
}): GeoCorners {
  const { bbox, estimate } = opts;
  const cxNorm = Math.min(0.92, Math.max(0.08, Number(estimate.center_x_norm) || 0.5));
  const cyNorm = Math.min(0.92, Math.max(0.08, Number(estimate.center_y_norm) || 0.5));
  const widthFrac = Math.min(0.95, Math.max(0.08, Number(estimate.width_frac) || 0.45));
  const rotDeg = Number.isFinite(Number(estimate.rotation_deg))
    ? ((Number(estimate.rotation_deg) + 540) % 360) - 180
    : 0;
  const aspect =
    opts.aspectRatio && Number.isFinite(opts.aspectRatio) && opts.aspectRatio > 0.2 && opts.aspectRatio < 5
      ? opts.aspectRatio
      : 4 / 3;

  const centerLng = bbox.west + cxNorm * (bbox.east - bbox.west);
  // Image Y=0 is North (top), Y=1 is South (bottom)
  const centerLat = bbox.north - cyNorm * (bbox.north - bbox.south);

  const metersPerDegLat = 111_320;
  const cosLat = Math.max(Math.cos((centerLat * Math.PI) / 180), 0.1);
  const metersPerDegLng = metersPerDegLat * cosLat;

  const bboxWidthM = (bbox.east - bbox.west) * metersPerDegLng;
  const halfW = (bboxWidthM * widthFrac) / 2;
  const halfH = halfW / aspect;

  const dLat = halfH / metersPerDegLat;
  const dLng = halfW / metersPerDegLng;

  const base: GeoCorners = {
    tl: { lat: centerLat + dLat, lng: centerLng - dLng },
    tr: { lat: centerLat + dLat, lng: centerLng + dLng },
    bl: { lat: centerLat - dLat, lng: centerLng - dLng },
  };

  return Math.abs(rotDeg) > 0.25 ? rotateCorners(base, rotDeg) : base;
}
