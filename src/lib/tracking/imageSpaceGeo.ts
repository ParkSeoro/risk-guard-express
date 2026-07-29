/**
 * Image-space (orthogonal / CRS.Simple) ↔ WGS84 via site_maps geo_transform.
 *
 * Image UV: (0,0)=TL, (1,0)=TR, (0,1)=BL — matches leaflet-imageoverlay-rotated corners.
 * Affine: P(u,v) = TL + u*(TR−TL) + v*(BL−TL)
 *
 * Axis-aligned GPS Bounds (mapping tab TopLeft / BottomRight) use linear interpolation:
 *   lat = TL.lat + (py / H) * (BR.lat − TL.lat)
 *   lng = TL.lng + (px / W) * (BR.lng − TL.lng)
 * where (px, py) is pixel from the image top-left.
 */
import {
  bottomRight,
  type GeoCorners,
  type LatLngLiteral,
} from "@/lib/mapBounds";

export type ImageUv = { u: number; v: number };

/** Original drone photo GPS bounds (mapping tab SSOT). */
export type GpsImageBounds = {
  topLeft: LatLngLiteral;
  bottomRight: LatLngLiteral;
};

/** Affine map UV → lat/lng using georef corners (rotation/skew included). */
export function uvToLatLng(uv: ImageUv, corners: GeoCorners): LatLngLiteral {
  const { tl, tr, bl } = corners;
  return {
    lat: tl.lat + uv.u * (tr.lat - tl.lat) + uv.v * (bl.lat - tl.lat),
    lng: tl.lng + uv.u * (tr.lng - tl.lng) + uv.v * (bl.lng - tl.lng),
  };
}

/**
 * Pixel (x from left, y from top) → WGS84 via TL/BR linear interpolation.
 * Prefer {@link translateCrsToGps} / corners when geo_transform has rotation/skew.
 */
export function translatePixelToGps(
  px: number,
  py: number,
  imageWidth: number,
  imageHeight: number,
  gpsBounds: GpsImageBounds,
): LatLngLiteral {
  const w = Math.max(imageWidth, 1);
  const h = Math.max(imageHeight, 1);
  const { topLeft: tl, bottomRight: br } = gpsBounds;
  const u = px / w;
  const v = py / h;
  return {
    lat: tl.lat + v * (br.lat - tl.lat),
    lng: tl.lng + u * (br.lng - tl.lng),
  };
}

/** Build TL/BR GPS bounds from geo corners (BR derived from parallelogram). */
export function gpsBoundsFromCorners(corners: GeoCorners): GpsImageBounds {
  return {
    topLeft: { ...corners.tl },
    bottomRight: bottomRight(corners),
  };
}

/**
 * CRS.Simple “lat/lng” (actually y/x image units) → real WGS84.
 * Uses affine UV when corners include TR/BL (handles rotation); equivalent to
 * TL/BR linear interpolation for axis-aligned orthophotos.
 */
export function translateCrsToGps(
  crsPoint: { lat: number; lng: number },
  corners: GeoCorners,
  imageWidth: number,
  imageHeight: number,
): LatLngLiteral {
  const uv = crsLatLngToUv(crsPoint, imageWidth, imageHeight);
  return uvToLatLng(uv, corners);
}

/** Heuristic: reject CRS pixel-scale values mistaken for GPS before DB write. */
export function looksLikeWgs84(p: LatLngLiteral): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}

export function formatGpsPreview(shape: {
  kind: "polygon" | "circle";
  latlngs?: LatLngLiteral[];
  center?: LatLngLiteral;
  radius_m?: number;
}): string {
  if (shape.kind === "circle" && shape.center) {
    const { lat, lng } = shape.center;
    return `📍 변환된 GPS 좌표: [${lat.toFixed(6)}, ${lng.toFixed(6)}] · 반경 ${shape.radius_m ?? "?"}m`;
  }
  const pts = shape.latlngs || [];
  if (!pts.length) return "";
  const body = pts
    .map((p) => `[${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}]`)
    .join(", ");
  return `📍 변환된 GPS 좌표: ${body}`;
}

export function polygonUvToLatLng(
  ring: ImageUv[],
  corners: GeoCorners,
): LatLngLiteral[] {
  return ring.map((p) => uvToLatLng(p, corners));
}

/**
 * Inverse: lat/lng → UV by solving the 2×2 affine system in a local metric frame.
 * Falls back to AABB projection if the parallelogram is degenerate.
 */
export function latLngToUv(p: LatLngLiteral, corners: GeoCorners): ImageUv {
  const { tl, tr, bl } = corners;
  const cosLat = Math.cos((tl.lat * Math.PI) / 180) || 1e-6;

  // Local meters-ish: x ~ lng*cos, y ~ lat
  const toXY = (q: LatLngLiteral) => ({
    x: (q.lng - tl.lng) * cosLat,
    y: q.lat - tl.lat,
  });
  const P = toXY(p);
  const U = toXY(tr); // TR−TL
  const V = toXY(bl); // BL−TL

  const det = U.x * V.y - U.y * V.x;
  if (Math.abs(det) < 1e-18) {
    // Degenerate — AABB fallback
    const br = bottomRight(corners);
    const minLat = Math.min(tl.lat, tr.lat, bl.lat, br.lat);
    const maxLat = Math.max(tl.lat, tr.lat, bl.lat, br.lat);
    const minLng = Math.min(tl.lng, tr.lng, bl.lng, br.lng);
    const maxLng = Math.max(tl.lng, tr.lng, bl.lng, br.lng);
    const u = maxLng === minLng ? 0 : (p.lng - minLng) / (maxLng - minLng);
    const v = maxLat === minLat ? 0 : (maxLat - p.lat) / (maxLat - minLat);
    return { u, v };
  }

  const u = (P.x * V.y - P.y * V.x) / det;
  const v = (U.x * P.y - U.y * P.x) / det;
  return { u, v };
}

export function polygonLatLngToUv(
  ring: LatLngLiteral[],
  corners: GeoCorners,
): ImageUv[] {
  return ring.map((p) => latLngToUv(p, corners));
}

/**
 * Approximate ground meters per image UV unit along u (width) and v (height),
 * using local metric at TL. Used to convert CRS.Simple circle radius → meters.
 */
export function metersPerUv(corners: GeoCorners): { mu: number; mv: number } {
  const { tl, tr, bl } = corners;
  const cosLat = Math.cos((tl.lat * Math.PI) / 180) || 1e-6;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * cosLat;
  const duLat = tr.lat - tl.lat;
  const duLng = tr.lng - tl.lng;
  const dvLat = bl.lat - tl.lat;
  const dvLng = bl.lng - tl.lng;
  const mu = Math.hypot(duLat * mPerDegLat, duLng * mPerDegLng) || 1;
  const mv = Math.hypot(dvLat * mPerDegLat, dvLng * mPerDegLng) || 1;
  return { mu, mv };
}

/** Average meters-per-CRS-unit when image is placed in [[0,0],[H,W]] CRS.Simple bounds. */
export function metersPerCrsUnit(
  corners: GeoCorners,
  imageWidth: number,
  imageHeight: number,
): number {
  const { mu, mv } = metersPerUv(corners);
  const w = Math.max(imageWidth, 1);
  const h = Math.max(imageHeight, 1);
  // 1 CRS x-unit ≈ mu/w meters; 1 CRS y-unit ≈ mv/h meters — use mean
  return (mu / w + mv / h) / 2;
}

/**
 * CRS.Simple image placement:
 * - SW = [0, 0], NE = [height, width]  (Leaflet [lat, lng] = [y, x])
 * - ImageOverlay maps image top → north edge (lat=height), bottom → lat=0
 * - Pixel (px from left, py from top) → CRS: lng=px, lat=height-py
 */
export function pixelToUv(
  px: number,
  py: number,
  imageWidth: number,
  imageHeight: number,
): ImageUv {
  const w = Math.max(imageWidth, 1);
  const h = Math.max(imageHeight, 1);
  return { u: px / w, v: py / h };
}

export function uvToCrsLatLng(
  uv: ImageUv,
  imageWidth: number,
  imageHeight: number,
): { lat: number; lng: number } {
  const w = Math.max(imageWidth, 1);
  const h = Math.max(imageHeight, 1);
  return {
    lng: uv.u * w,
    lat: h * (1 - uv.v),
  };
}

export function crsLatLngToUv(
  p: { lat: number; lng: number },
  imageWidth: number,
  imageHeight: number,
): ImageUv {
  const w = Math.max(imageWidth, 1);
  const h = Math.max(imageHeight, 1);
  return {
    u: p.lng / w,
    v: 1 - p.lat / h,
  };
}

export function imageCrsBounds(
  imageWidth: number,
  imageHeight: number,
): [[number, number], [number, number]] {
  const w = Math.max(imageWidth, 1);
  const h = Math.max(imageHeight, 1);
  return [
    [0, 0],
    [h, w],
  ];
}

/** CRS.Simple polygon ring → WGS84 via UV + geo corners (pixel → GPS inverse). */
export function crsPolygonToGeo(
  crsRing: { lat: number; lng: number }[],
  corners: GeoCorners,
  imageWidth: number,
  imageHeight: number,
): LatLngLiteral[] {
  return crsRing.map((p) => translateCrsToGps(p, corners, imageWidth, imageHeight));
}

/** WGS84 polygon → CRS.Simple ring for orthogonal display. */
export function geoPolygonToCrs(
  geoRing: LatLngLiteral[],
  corners: GeoCorners,
  imageWidth: number,
  imageHeight: number,
): { lat: number; lng: number }[] {
  return geoRing.map((p) => {
    const uv = latLngToUv(p, corners);
    return uvToCrsLatLng(uv, imageWidth, imageHeight);
  });
}

/** CRS.Simple circle (center + radius in CRS units) → geo center + radius_m. */
export function crsCircleToGeo(
  center: { lat: number; lng: number },
  radiusCrs: number,
  corners: GeoCorners,
  imageWidth: number,
  imageHeight: number,
): { center: LatLngLiteral; radius_m: number } {
  const uv = crsLatLngToUv(center, imageWidth, imageHeight);
  const geoCenter = uvToLatLng(uv, corners);
  const mpu = metersPerCrsUnit(corners, imageWidth, imageHeight);
  return {
    center: geoCenter,
    radius_m: Math.max(0.5, Math.round(radiusCrs * mpu * 10) / 10),
  };
}

/** Geo circle → CRS.Simple center + radius for display. */
export function geoCircleToCrs(
  center: LatLngLiteral,
  radius_m: number,
  corners: GeoCorners,
  imageWidth: number,
  imageHeight: number,
): { center: { lat: number; lng: number }; radius: number } {
  const uv = latLngToUv(center, corners);
  const crsCenter = uvToCrsLatLng(uv, imageWidth, imageHeight);
  const mpu = metersPerCrsUnit(corners, imageWidth, imageHeight) || 1;
  return { center: crsCenter, radius: radius_m / mpu };
}
