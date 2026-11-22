/**
 * Pure geometry and measurement helpers for InteractiveLeafletDraw.
 * Works seamlessly in both WGS84 geographic maps and CRS.Simple flat image canvases.
 */

export type DrawPoint = { lat: number; lng: number };
export type CoordinateMode = "wgs84" | "crs";

const EARTH_RADIUS_M = 6371000;

export function haversineMeters(a: DrawPoint, b: DrawPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, s)));
}

/** Build a 4-corner polygon ring from any two opposite corners. */
export function buildRectangleRing(a: DrawPoint, b: DrawPoint): DrawPoint[] {
  const minLat = Math.min(a.lat, b.lat);
  const maxLat = Math.max(a.lat, b.lat);
  const minLng = Math.min(a.lng, b.lng);
  const maxLng = Math.max(a.lng, b.lng);
  return [
    { lat: maxLat, lng: minLng },
    { lat: maxLat, lng: maxLng },
    { lat: minLat, lng: maxLng },
    { lat: minLat, lng: minLng },
  ];
}

/**
 * Compute circle radius in map units (meters for WGS84, CRS units for CRS.Simple)
 * alongside display meters for live UX readout.
 */
export function computeCircleRadius(
  center: DrawPoint,
  edge: DrawPoint,
  mode: CoordinateMode,
  metersPerCrsUnit = 1,
): { mapRadius: number; displayMeters: number } {
  if (mode === "wgs84") {
    const m = haversineMeters(center, edge);
    const rounded = Math.round(m * 10) / 10;
    return { mapRadius: rounded, displayMeters: rounded };
  }
  const crsUnits = Math.hypot(edge.lng - center.lng, edge.lat - center.lat);
  const roundedUnits = Math.round(crsUnits * 10) / 10;
  const displayMeters = Math.round(crsUnits * Math.max(metersPerCrsUnit, 0) * 10) / 10;
  return { mapRadius: roundedUnits, displayMeters };
}

/** Compute real-world width × height in meters for a rectangle preview. */
export function measureRectangleMeters(
  a: DrawPoint,
  b: DrawPoint,
  mode: CoordinateMode,
  metersPerCrsUnit = 1,
): { widthM: number; heightM: number } {
  if (mode === "wgs84") {
    const midLat = (a.lat + b.lat) / 2;
    const widthM = haversineMeters({ lat: midLat, lng: a.lng }, { lat: midLat, lng: b.lng });
    const heightM = haversineMeters({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: a.lng });
    return { widthM, heightM };
  }
  const scale = Math.max(metersPerCrsUnit, 0);
  return {
    widthM: Math.abs(b.lng - a.lng) * scale,
    heightM: Math.abs(b.lat - a.lat) * scale,
  };
}

/** Compute segment distance in meters for live polygon edge measurement. */
export function measureSegmentMeters(
  a: DrawPoint,
  b: DrawPoint,
  mode: CoordinateMode,
  metersPerCrsUnit = 1,
): number {
  if (mode === "wgs84") return haversineMeters(a, b);
  return Math.hypot(b.lng - a.lng, b.lat - a.lat) * Math.max(metersPerCrsUnit, 0);
}

/** Compute a point offset east from circle center for the radius drag handle. */
export function circleEastHandlePoint(
  center: DrawPoint,
  mapRadius: number,
  mode: CoordinateMode,
): DrawPoint {
  if (mode === "crs") {
    return { lat: center.lat, lng: center.lng + mapRadius };
  }
  const cosLat = Math.max(Math.cos((center.lat * Math.PI) / 180), 1e-4);
  const dLng = mapRadius / (111_320 * cosLat);
  return { lat: center.lat, lng: center.lng + dLng };
}

/** Magnetic snap check in screen pixels. */
export function isWithinScreenRadius(
  a: { x: number; y: number },
  b: { x: number; y: number },
  radiusPx = 16,
): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= radiusPx;
}

export function polygonCentroid(pts: DrawPoint[]): DrawPoint | null {
  if (!pts.length) return null;
  let sumLat = 0;
  let sumLng = 0;
  for (const p of pts) {
    sumLat += p.lat;
    sumLng += p.lng;
  }
  return { lat: sumLat / pts.length, lng: sumLng / pts.length };
}

export function translatePolygon(pts: DrawPoint[], dLat: number, dLng: number): DrawPoint[] {
  return pts.map((p) => ({ lat: p.lat + dLat, lng: p.lng + dLng }));
}

export function insertVertexAt(pts: DrawPoint[], afterIndex: number, pt: DrawPoint): DrawPoint[] {
  const idx = Math.max(0, Math.min(pts.length, afterIndex + 1));
  return [...pts.slice(0, idx), pt, ...pts.slice(idx)];
}

export function removeVertexAt(pts: DrawPoint[], index: number): DrawPoint[] {
  if (pts.length <= 3) return pts;
  if (index < 0 || index >= pts.length) return pts;
  return [...pts.slice(0, index), ...pts.slice(index + 1)];
}

export function edgeMidpoints(pts: DrawPoint[]): DrawPoint[] {
  if (pts.length < 2) return [];
  const out: DrawPoint[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    out.push({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
  }
  return out;
}

export function formatMetersLabel(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return "0m";
  if (meters < 10) return `${meters.toFixed(1)}m`;
  return `${Math.round(meters)}m`;
}
