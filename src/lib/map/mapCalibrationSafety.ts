/**
 * SiteControlMap Phase 1 safety & non-distorting calibration helpers:
 * 1. Calibration status traffic light (green/yellow/red)
 * 2. 4-DOF 2-point landmark similarity alignment (zero skew/distortion)
 * 3. Pre-save attendance inclusion-rate simulation for [2] GPS 개소
 * 4. Guard against implicit clearing of project-wide gps_calibration
 */
import {
  cornersCenter,
  loadCornersFromMap,
  parseGeoTransform,
  type AnchorMap,
  type GeoCorners,
  type GeoTransformSource,
  type LatLngLiteral,
} from "@/lib/mapBounds";
import { offsetMagnitudeM, type GpsCalibration } from "@/lib/tracking/gpsCalibration";
import { isWithinAnySiteAttendance, type SiteBoundary } from "@/lib/tracking/siteBoundary";

export type CalibrationTrafficStatus = "green" | "yellow" | "red";

export type CalibrationHealth = {
  status: CalibrationTrafficStatus;
  label: string;
  detail: string;
  source: GeoTransformSource | null;
};

export function evaluateMapCalibrationHealth(
  mapRow: (AnchorMap & { image_url?: string | null }) | null | undefined,
  draftCorners?: GeoCorners | null,
): CalibrationHealth {
  if (!mapRow || !mapRow.image_url) {
    return {
      status: "red",
      label: "도면 없음",
      detail: "드론·현장 도면을 올리거나 위성 지도에서 바로 구역을 설정하세요.",
      source: null,
    };
  }
  const corners = draftCorners ?? loadCornersFromMap(mapRow);
  const tf = parseGeoTransform(mapRow.geo_transform);
  const source = tf?.source ?? null;

  if (!corners) {
    return {
      status: "red",
      label: "미보정",
      detail: "도면 좌표가 아직 없습니다. 모바일 워킹 보정 또는 2점 맞춤으로 정렬하세요.",
      source,
    };
  }

  if (source === "walk") {
    return {
      status: "green",
      label: "워킹 보정 완료",
      detail: "현장 실측 GPS(4자유도 유사변환)로 정밀 보정된 도면입니다.",
      source,
    };
  }

  const sourceDesc =
    source === "exif"
      ? "드론 EXIF GPS로 자동 배치됨"
      : source === "two-point"
        ? "2점 기준점(비율 고정)으로 정렬됨"
        : source === "pc-satellite"
          ? "PC 위성 수동 정렬됨"
          : "임시 초기 배치됨";

  return {
    status: "yellow",
    label: "임시 정렬 (워킹 보정 권장)",
    detail: `${sourceDesc}. 실제 현장 정확도를 높이려면 모바일 워킹 보정을 권장합니다.`,
    source,
  };
}

/**
 * Compute a rigid 4-DOF Similarity Transform (translation + uniform scale + rotation,
 * ZERO shear/skew) that maps two points on the current overlay (`p1Img`, `p2Img`)
 * onto two target WGS-84 coordinates (`p1Sat`, `p2Sat`).
 */
export function alignCornersFromTwoLandmarks(
  current: GeoCorners,
  p1Img: LatLngLiteral,
  p1Sat: LatLngLiteral,
  p2Img: LatLngLiteral,
  p2Sat: LatLngLiteral,
): GeoCorners | { error: string } {
  const refLat = cornersCenter(current).lat;
  const cosLat = Math.max(Math.cos((refLat * Math.PI) / 180), 0.1);
  const M_PER_DEG = 111_320;

  const toXY = (p: LatLngLiteral) => ({
    x: (p.lng - p1Img.lng) * M_PER_DEG * cosLat,
    y: (p.lat - p1Img.lat) * M_PER_DEG,
  });
  const toSatXY = (p: LatLngLiteral) => ({
    x: (p.lng - p1Sat.lng) * M_PER_DEG * cosLat,
    y: (p.lat - p1Sat.lat) * M_PER_DEG,
  });

  const vImg = toXY(p2Img);
  const vSat = toSatXY(p2Sat);
  const lenImg = Math.hypot(vImg.x, vImg.y);
  const lenSat = Math.hypot(vSat.x, vSat.y);

  if (lenImg < 3) {
    return { error: "도면 위 두 기준점이 너무 가깝습니다(3m 이상 떨어뜨려 찍어주세요)." };
  }
  if (lenSat < 3) {
    return { error: "위성 위 두 기준점이 너무 가깝습니다(3m 이상 떨어뜨려 찍어주세요)." };
  }

  const scale = lenSat / lenImg;
  if (!Number.isFinite(scale) || scale < 0.1 || scale > 10) {
    return {
      error: `축척 변화(${scale.toFixed(2)}배)가 비정상적으로 큽니다. 두 기준점을 다시 확인하세요.`,
    };
  }

  const angle = Math.atan2(vSat.y, vSat.x) - Math.atan2(vImg.y, vImg.x);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  const transformPt = (p: LatLngLiteral): LatLngLiteral => {
    const q = toXY(p);
    const rx = scale * (q.x * cosA - q.y * sinA);
    const ry = scale * (q.x * sinA + q.y * cosA);
    return {
      lat: p1Sat.lat + ry / M_PER_DEG,
      lng: p1Sat.lng + rx / (M_PER_DEG * cosLat),
    };
  };

  return {
    tl: transformPt(current.tl),
    tr: transformPt(current.tr),
    bl: transformPt(current.bl),
  };
}

export type WorkerGpsSample = {
  lat: number;
  lng: number;
  accuracy_m?: number | null;
};

export type AttendanceImpactResult = {
  total: number;
  included: number;
  excluded: number;
  inclusionPct: number;
  severity: "safe" | "warn" | "danger";
};

/**
 * Simulate how many currently checked-in workers fall inside the union of `candidateSpots`.
 * Uses the exact same `isWithinAnySiteAttendance` logic as live attendance validation.
 */
export function simulateSpotAttendanceImpact(opts: {
  candidateSpots: SiteBoundary[];
  workers: WorkerGpsSample[];
}): AttendanceImpactResult {
  const validWorkers = opts.workers.filter(
    (w) => Number.isFinite(w.lat) && Number.isFinite(w.lng),
  );
  const total = validWorkers.length;
  if (total === 0) {
    return { total: 0, included: 0, excluded: 0, inclusionPct: 100, severity: "safe" };
  }
  if (opts.candidateSpots.length === 0) {
    return { total, included: 0, excluded: total, inclusionPct: 0, severity: "danger" };
  }

  let included = 0;
  for (const w of validWorkers) {
    if (
      isWithinAnySiteAttendance(
        opts.candidateSpots,
        w.lat,
        w.lng,
        w.accuracy_m ?? undefined,
      )
    ) {
      included++;
    }
  }
  const excluded = total - included;
  const inclusionPct = Math.round((included / total) * 100);
  const severity: AttendanceImpactResult["severity"] =
    inclusionPct < 50 ? "danger" : inclusionPct < 80 ? "warn" : "safe";

  return { total, included, excluded, inclusionPct, severity };
}

/**
 * Guard helper: never implicitly clear project-wide `gps_calibration` when saving map alignment.
 */
export function describeGpsCalibrationGuard(
  existingCal: GpsCalibration | null | undefined,
  spotCount: number,
): { hasCalibration: boolean; offsetM: number; keepRecommended: boolean } {
  if (!existingCal) {
    return { hasCalibration: false, offsetM: 0, keepRecommended: true };
  }
  const offsetM = Math.round(
    offsetMagnitudeM(existingCal.d_lat, existingCal.d_lng, existingCal.map_lat || 37),
  );
  return {
    hasCalibration: true,
    offsetM,
    // Always default to keeping unless the operator explicitly chooses to clear it.
    keepRecommended: spotCount >= 2 || true,
  };
}
