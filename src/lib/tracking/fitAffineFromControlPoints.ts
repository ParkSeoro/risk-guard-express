/**
 * Fit site_maps geo_transform (TL/TR/BL) from N UV↔GPS control points.
 * Affine: P(u,v) = (1−u−v)·TL + u·TR + v·BL
 * Solves lat and lng separately via least squares (3+ points).
 */
import type { GeoCorners, LatLngLiteral } from "@/lib/mapBounds";
import type { ImageUv } from "@/lib/tracking/imageSpaceGeo";
import { uvToLatLng } from "@/lib/tracking/imageSpaceGeo";
import { calculateDistance } from "@/lib/geo/calculateDistance";

export type WalkControlPoint = {
  id: string;
  u: number;
  v: number;
  lat: number;
  lng: number;
  accuracy_m?: number;
};

export type AffineFitResult = {
  corners: GeoCorners;
  /** RMS residual in meters over control points. */
  rmsM: number;
  /** Per-point residual meters. */
  residualsM: number[];
};

/** Solve Ax = b for 3 unknowns (normal equations). */
function solve3(AtA: number[][], Atb: number[]): number[] | null {
  // Gaussian elimination with partial pivot
  const M = [
    [AtA[0][0], AtA[0][1], AtA[0][2], Atb[0]],
    [AtA[1][0], AtA[1][1], AtA[1][2], Atb[1]],
    [AtA[2][0], AtA[2][1], AtA[2][2], Atb[2]],
  ];
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-18) return null;
    if (pivot !== col) {
      const tmp = M[col];
      M[col] = M[pivot];
      M[pivot] = tmp;
    }
    const div = M[col][col];
    for (let c = col; c < 4; c++) M[col][c] /= div;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = col; c < 4; c++) M[r][c] -= f * M[col][c];
    }
  }
  return [M[0][3], M[1][3], M[2][3]];
}

function fitChannel(points: WalkControlPoint[], channel: "lat" | "lng"): number[] | null {
  // x = [TL, TR, BL]
  // row: [(1-u-v), u, v] · x = value
  const AtA = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const Atb = [0, 0, 0];
  for (const p of points) {
    const a0 = 1 - p.u - p.v;
    const a1 = p.u;
    const a2 = p.v;
    const y = channel === "lat" ? p.lat : p.lng;
    const row = [a0, a1, a2];
    for (let i = 0; i < 3; i++) {
      Atb[i] += row[i] * y;
      for (let j = 0; j < 3; j++) AtA[i][j] += row[i] * row[j];
    }
  }
  return solve3(AtA, Atb);
}

/** Triangle area in UV (absolute) — reject near-collinear sets. */
export function controlPointsUvArea(points: ImageUv[]): number {
  if (points.length < 3) return 0;
  // Use first 3 for a quick collinearity check; for N>3 use convex hull approx via max area triplet
  let maxArea = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      for (let k = j + 1; k < points.length; k++) {
        const a = points[i];
        const b = points[j];
        const c = points[k];
        const area = Math.abs(
          (a.u * (b.v - c.v) + b.u * (c.v - a.v) + c.u * (a.v - b.v)) / 2,
        );
        maxArea = Math.max(maxArea, area);
      }
    }
  }
  return maxArea;
}

export function fitAffineFromControlPoints(
  points: WalkControlPoint[],
): AffineFitResult | { error: string } {
  if (points.length < 3) {
    return { error: "최소 3개 지점이 필요합니다" };
  }
  for (const p of points) {
    if (!Number.isFinite(p.u) || !Number.isFinite(p.v) || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
      return { error: "좌표가 올바르지 않은 지점이 있습니다" };
    }
  }
  const area = controlPointsUvArea(points);
  if (area < 0.01) {
    return { error: "지점이 한 줄에 가깝습니다. 서로 떨어진 위치를 찍어주세요" };
  }

  const latX = fitChannel(points, "lat");
  const lngX = fitChannel(points, "lng");
  if (!latX || !lngX) {
    return { error: "변환 계산 실패 — 지점을 더 넓게 잡아주세요" };
  }

  const corners: GeoCorners = {
    tl: { lat: latX[0], lng: lngX[0] },
    tr: { lat: latX[1], lng: lngX[1] },
    bl: { lat: latX[2], lng: lngX[2] },
  };

  // Sanity: corners should be finite and roughly near control GPS
  for (const c of [corners.tl, corners.tr, corners.bl]) {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) {
      return { error: "변환 결과가 유효하지 않습니다" };
    }
  }

  const residualsM: number[] = [];
  let sumSq = 0;
  for (const p of points) {
    const pred = uvToLatLng({ u: p.u, v: p.v }, corners);
    const d = calculateDistance(pred.lat, pred.lng, p.lat, p.lng);
    residualsM.push(d);
    sumSq += d * d;
  }
  const rmsM = Math.sqrt(sumSq / points.length);

  if (rmsM > 80) {
    return {
      error: `잔차 ≈${Math.round(rmsM)}m 로 너무 큽니다. GPS·핀 위치를 다시 확인하세요`,
    };
  }

  return { corners, rmsM, residualsM };
}

/** Mean residual bias mapWGS84 − rawGPS after affine (optional 1-point cleanup). */
export function residualBiasFromFit(
  points: WalkControlPoint[],
  corners: GeoCorners,
): { d_lat: number; d_lng: number } | null {
  if (!points.length) return null;
  let sLat = 0;
  let sLng = 0;
  for (const p of points) {
    const mapPt = uvToLatLng({ u: p.u, v: p.v }, corners);
    // After we write corners from GPS, residuals should be ~0.
    // Bias for phone is map − raw; here GPS already IS the truth used to fit.
    sLat += mapPt.lat - p.lat;
    sLng += mapPt.lng - p.lng;
  }
  return { d_lat: sLat / points.length, d_lng: sLng / points.length };
}

export type { LatLngLiteral };
