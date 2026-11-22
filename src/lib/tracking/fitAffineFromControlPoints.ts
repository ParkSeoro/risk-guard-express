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

export type SimilarityFitResult = AffineFitResult & {
  /** Largest single-point residual in meters (helps spot which point had GPS jump / wrong tap). */
  maxResidualM: number;
  /** Estimated ground width (meters) of the drone image. */
  widthM: number;
  /** Estimated ground height (meters) of the drone image. */
  heightM: number;
  /** Rotation angle in degrees (clockwise from North-up). */
  rotationDeg: number;
};

export type GpsSample = {
  lat: number;
  lng: number;
  accuracy: number;
};

export type AggregatedGpsFix = {
  lat: number;
  lng: number;
  accuracy_m: number;
  sampleCount: number;
  keptCount: number;
  spreadM: number;
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

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Aggregate multiple GPS fixes collected while standing still at a calibration landmark:
 * 1) Drops samples worse than `maxAccuracyM` (unless all exceed it -> returns error).
 * 2) Computes median (lat, lng) and rejects multipath outliers far from the median.
 * 3) Computes inverse-variance weighted mean (weight = 1 / max(accuracy, 3)^2).
 */
export function aggregateGpsSamples(
  samples: GpsSample[],
  maxAccuracyM = 35,
): AggregatedGpsFix | { error: string } {
  const valid = samples.filter(
    (s) =>
      Number.isFinite(s.lat) &&
      Number.isFinite(s.lng) &&
      Number.isFinite(s.accuracy) &&
      s.accuracy > 0 &&
      s.accuracy <= maxAccuracyM,
  );
  if (valid.length === 0) {
    const bestAcc = samples
      .map((s) => s.accuracy)
      .filter((a) => Number.isFinite(a) && a > 0)
      .sort((a, b) => a - b)[0];
    return {
      error:
        bestAcc != null
          ? `GPS 정확도 ±${Math.round(bestAcc)}m — 야외에서 ${maxAccuracyM}m 이하일 때 다시 측정하세요`
          : "유효한 GPS 샘플을 수신하지 못했습니다",
    };
  }

  const medLat = median(valid.map((s) => s.lat));
  const medLng = median(valid.map((s) => s.lng));
  const medAcc = median(valid.map((s) => s.accuracy));
  const outlierGateM = Math.max(15, medAcc * 2);

  let kept = valid.filter((s) => calculateDistance(s.lat, s.lng, medLat, medLng) <= outlierGateM);
  if (kept.length === 0) kept = valid;

  let wSum = 0;
  let latSum = 0;
  let lngSum = 0;
  let accSum = 0;
  for (const s of kept) {
    const sigma = Math.max(s.accuracy, 3);
    const w = 1 / (sigma * sigma);
    wSum += w;
    latSum += s.lat * w;
    lngSum += s.lng * w;
    accSum += s.accuracy * w;
  }

  const lat = latSum / wSum;
  const lng = lngSum / wSum;
  const accuracy_m = accSum / wSum;
  const spreadM = kept.reduce(
    (maxD, s) => Math.max(maxD, calculateDistance(lat, lng, s.lat, s.lng)),
    0,
  );

  return {
    lat,
    lng,
    accuracy_m,
    sampleCount: samples.length,
    keptCount: kept.length,
    spreadM,
  };
}

/**
 * 4-DOF orientation-preserving Similarity Fit (translation + rotation + uniform scale)
 * for rectangular drone photos.
 *
 * Unlike unconstrained 6-DOF affine (which has 0 degrees of freedom on 3 points and
 * always reports 0m RMS while shearing/skewing the image), 4-DOF similarity preserves
 * exact image aspect ratio and 90° corners, producing REAL residual error metrics even
 * from 3 control points (2 degrees of freedom; 4+ points give even stronger accuracy).
 */
export function fitSimilarityFromControlPoints(
  points: WalkControlPoint[],
  imageAspectRatio = 4 / 3,
): SimilarityFitResult | { error: string } {
  if (points.length < 3) {
    return { error: "최소 3개 지점이 필요합니다" };
  }
  for (const p of points) {
    if (
      !Number.isFinite(p.u) ||
      !Number.isFinite(p.v) ||
      !Number.isFinite(p.lat) ||
      !Number.isFinite(p.lng)
    ) {
      return { error: "좌표가 올바르지 않은 지점이 있습니다" };
    }
  }

  const area = controlPointsUvArea(points);
  if (area < 0.008) {
    return { error: "지점이 한 줄에 가깝습니다. 현장 각 모서리처럼 넓게 떨어진 3곳 이상을 찍어주세요" };
  }

  const aspect =
    Number.isFinite(imageAspectRatio) && imageAspectRatio > 0.1 && imageAspectRatio < 10
      ? imageAspectRatio
      : 4 / 3;

  // Tangent-plane meters centered at control-point mean lat/lng
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lng0 = points.reduce((s, p) => s + p.lng, 0) / points.length;
  const mPerDegLat = 111_320;
  const mPerDegLng = Math.max(111_320 * Math.cos((lat0 * Math.PI) / 180), 1e-3);

  // Image space: x = u * aspect (right = +x), y = -v (up = +y, matching North = +N)
  const xs = points.map((p) => p.u * aspect);
  const ys = points.map((p) => -p.v);
  const Es = points.map((p) => (p.lng - lng0) * mPerDegLng);
  const Ns = points.map((p) => (p.lat - lat0) * mPerDegLat);

  const meanX = xs.reduce((s, x) => s + x, 0) / points.length;
  const meanY = ys.reduce((s, y) => s + y, 0) / points.length;
  const meanE = Es.reduce((s, e) => s + e, 0) / points.length;
  const meanN = Ns.reduce((s, n) => s + n, 0) / points.length;

  let denom = 0;
  let numA = 0;
  let numB = 0;
  for (let i = 0; i < points.length; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    const dE = Es[i] - meanE;
    const dN = Ns[i] - meanN;
    denom += dx * dx + dy * dy;
    numA += dx * dE + dy * dN;
    numB += dx * dN - dy * dE;
  }

  if (denom < 1e-9) {
    return { error: "도면 지점이 너무 가깝습니다. 서로 떨어진 위치를 찍어주세요" };
  }

  // E = a*x - b*y + tE, N = b*x + a*y + tN  (strictly orientation-preserving!)
  const a = numA / denom;
  const b = numB / denom;
  const scale = Math.hypot(a, b); // meters per 1 unit of image height (v=0..1)
  if (!Number.isFinite(scale) || scale < 5 || scale > 8000) {
    return {
      error: `추정 도면 크기가 비정상입니다(≈${Math.round(scale || 0)}m). 핀 위치와 GPS를 다시 확인하세요`,
    };
  }

  const tE = meanE - (a * meanX - b * meanY);
  const tN = meanN - (b * meanX + a * meanY);

  const uvToGeo = (u: number, v: number): LatLngLiteral => {
    const x = u * aspect;
    const y = -v;
    const E = a * x - b * y + tE;
    const N = b * x + a * y + tN;
    return {
      lat: lat0 + N / mPerDegLat,
      lng: lng0 + E / mPerDegLng,
    };
  };

  const corners: GeoCorners = {
    tl: uvToGeo(0, 0),
    tr: uvToGeo(1, 0),
    bl: uvToGeo(0, 1),
  };

  const residualsM: number[] = [];
  let sumSq = 0;
  let maxResidualM = 0;
  for (const p of points) {
    const pred = uvToLatLng({ u: p.u, v: p.v }, corners);
    const d = calculateDistance(pred.lat, pred.lng, p.lat, p.lng);
    residualsM.push(d);
    sumSq += d * d;
    if (d > maxResidualM) maxResidualM = d;
  }
  const rmsM = Math.sqrt(sumSq / points.length);

  if (rmsM > 45) {
    return {
      error: `보정 오차(RMS ≈${Math.round(rmsM)}m)가 너무 큽니다. 오차가 큰 지점을 삭제하고 다시 측정하세요`,
    };
  }

  const heightM = scale;
  const widthM = scale * aspect;
  // Angle of image-up vector (0, 1) -> (-b, a) relative to North (0, 1)
  const rotationDeg = Math.round(((Math.atan2(-b, a) * 180) / Math.PI) * 10) / 10;

  return {
    corners,
    rmsM,
    maxResidualM,
    residualsM,
    widthM,
    heightM,
    rotationDeg,
  };
}

export type { LatLngLiteral };
