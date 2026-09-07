/**
 * Georef helpers: axis-aligned NW/SE anchors + 3-corner transform (TL/TR/BL)
 * for rotated/skewed drone ImageOverlay.
 */
import L from "leaflet";

export type LatLngLiteral = { lat: number; lng: number };

export type AnchorMap = {
  geo_anchor_nw_lat: number | null;
  geo_anchor_nw_lng: number | null;
  geo_anchor_se_lat: number | null;
  geo_anchor_se_lng: number | null;
  geo_transform?: GeoTransform | null;
};

/** Three corners for Leaflet.ImageOverlay.Rotated (+ optional opacity). */
export type GeoCorners = {
  tl: LatLngLiteral;
  tr: LatLngLiteral;
  bl: LatLngLiteral;
};

/** Leaflet camera on the control map — restored after tab/route remount. */
export type SiteMapView = {
  lat: number;
  lng: number;
  zoom: number;
};

export const GEO_TRANSFORM_SOURCES = ["walk", "pc-satellite", "seed", "photo"] as const;
export type GeoTransformSource = (typeof GEO_TRANSFORM_SOURCES)[number];

export type GeoTransform = GeoCorners & {
  opacity?: number;
  view?: SiteMapView;
  /** Who last wrote TL/TR/BL — walk, PC satellite, seed overlay, or site photo. */
  source?: GeoTransformSource;
};

export type PersistExtras = {
  view?: SiteMapView | null;
  source?: GeoTransformSource | null;
};

export type SwNeBounds = {
  sw: LatLngLiteral;
  ne: LatLngLiteral;
};

export function anchorsToSwNe(m: AnchorMap): SwNeBounds | null {
  if (
    m.geo_anchor_nw_lat == null ||
    m.geo_anchor_nw_lng == null ||
    m.geo_anchor_se_lat == null ||
    m.geo_anchor_se_lng == null
  ) {
    return null;
  }
  return {
    sw: {
      lat: Math.min(m.geo_anchor_nw_lat, m.geo_anchor_se_lat),
      lng: Math.min(m.geo_anchor_nw_lng, m.geo_anchor_se_lng),
    },
    ne: {
      lat: Math.max(m.geo_anchor_nw_lat, m.geo_anchor_se_lat),
      lng: Math.max(m.geo_anchor_nw_lng, m.geo_anchor_se_lng),
    },
  };
}

export function swNeToCorners(b: SwNeBounds): GeoCorners {
  return {
    tl: { lat: b.ne.lat, lng: b.sw.lng },
    tr: { lat: b.ne.lat, lng: b.ne.lng },
    bl: { lat: b.sw.lat, lng: b.sw.lng },
  };
}

export function cornersToSwNe(c: GeoCorners): SwNeBounds {
  const br = bottomRight(c);
  const lats = [c.tl.lat, c.tr.lat, c.bl.lat, br.lat];
  const lngs = [c.tl.lng, c.tr.lng, c.bl.lng, br.lng];
  return {
    sw: { lat: Math.min(...lats), lng: Math.min(...lngs) },
    ne: { lat: Math.max(...lats), lng: Math.max(...lngs) },
  };
}

export function bottomRight(c: GeoCorners): LatLngLiteral {
  return {
    lat: c.bl.lat + (c.tr.lat - c.tl.lat),
    lng: c.bl.lng + (c.tr.lng - c.tl.lng),
  };
}

export function cornersCenter(c: GeoCorners): LatLngLiteral {
  const br = bottomRight(c);
  return {
    lat: (c.tl.lat + br.lat) / 2,
    lng: (c.tl.lng + br.lng) / 2,
  };
}

export function cornersToLeafletBounds(c: GeoCorners): L.LatLngBoundsExpression {
  const b = cornersToSwNe(c);
  return [
    [b.sw.lat, b.sw.lng],
    [b.ne.lat, b.ne.lng],
  ];
}

/** Persist NW/SE bbox (legacy) + full 3-corner transform (+ optional camera). */
export function cornersToPersistPayload(
  c: GeoCorners,
  opacity = 0.85,
  extras?: PersistExtras,
) {
  const box = cornersToSwNe(c);
  const geo_transform: GeoTransform = {
    tl: c.tl,
    tr: c.tr,
    bl: c.bl,
    opacity,
  };
  if (extras?.view) geo_transform.view = extras.view;
  if (extras?.source) geo_transform.source = extras.source;
  return {
    geo_anchor_nw_lat: box.ne.lat,
    geo_anchor_nw_lng: box.sw.lng,
    geo_anchor_se_lat: box.sw.lat,
    geo_anchor_se_lng: box.ne.lng,
    geo_transform,
  };
}

export function parseGeoTransformSource(raw: unknown): GeoTransformSource | null {
  return typeof raw === "string" && (GEO_TRANSFORM_SOURCES as readonly string[]).includes(raw)
    ? (raw as GeoTransformSource)
    : null;
}

export function parseSiteMapView(raw: unknown): SiteMapView | null {
  if (!raw || typeof raw !== "object") return null;
  const v = (raw as Record<string, unknown>).view;
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const lat = Number(o.lat);
  const lng = Number(o.lng);
  const zoom = Number(o.zoom);
  if (![lat, lng, zoom].every(Number.isFinite)) return null;
  if (zoom < 1 || zoom > 22) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, zoom };
}

/** Merge camera into existing geo_transform without dropping TL/TR/BL. */
export function mergeViewIntoGeoTransform(existing: unknown, view: SiteMapView): unknown {
  const tf = parseGeoTransform(existing);
  if (tf) return { ...tf, view };
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return { ...(existing as Record<string, unknown>), view };
  }
  return { view };
}

export function parseGeoTransform(raw: unknown): GeoTransform | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const tl = o.tl as LatLngLiteral | undefined;
  const tr = o.tr as LatLngLiteral | undefined;
  const bl = o.bl as LatLngLiteral | undefined;
  if (
    !tl || !tr || !bl ||
    !Number.isFinite(tl.lat) || !Number.isFinite(tl.lng) ||
    !Number.isFinite(tr.lat) || !Number.isFinite(tr.lng) ||
    !Number.isFinite(bl.lat) || !Number.isFinite(bl.lng)
  ) {
    return null;
  }
  const view = parseSiteMapView(o);
  const source = parseGeoTransformSource(o.source);
  return {
    tl: { lat: tl.lat, lng: tl.lng },
    tr: { lat: tr.lat, lng: tr.lng },
    bl: { lat: bl.lat, lng: bl.lng },
    opacity: typeof o.opacity === "number" ? o.opacity : 0.85,
    ...(view ? { view } : {}),
    ...(source ? { source } : {}),
  };
}

/** Identity of overlay corners/opacity only — camera `view` must not trigger a remount/refit. */
export function georefCornersKey(m: AnchorMap): string {
  const tf = parseGeoTransform(m.geo_transform);
  if (tf) {
    return JSON.stringify({
      tl: tf.tl,
      tr: tf.tr,
      bl: tf.bl,
      opacity: tf.opacity ?? 0.85,
    });
  }
  return JSON.stringify([
    m.geo_anchor_nw_lat,
    m.geo_anchor_nw_lng,
    m.geo_anchor_se_lat,
    m.geo_anchor_se_lng,
  ]);
}

export function cornersEqual(
  a: GeoCorners | null | undefined,
  b: GeoCorners | null | undefined,
  eps = 1e-8,
): boolean {
  if (!a || !b) return a == b;
  const pts = (c: GeoCorners) => [c.tl, c.tr, c.bl];
  return pts(a).every(
    (p, i) => Math.abs(p.lat - pts(b)[i].lat) < eps && Math.abs(p.lng - pts(b)[i].lng) < eps,
  );
}

export function viewsEqual(
  a: SiteMapView | null | undefined,
  b: SiteMapView | null | undefined,
): boolean {
  if (!a || !b) return a == b;
  return (
    Math.abs(a.lat - b.lat) < 1e-7 &&
    Math.abs(a.lng - b.lng) < 1e-7 &&
    Math.abs(a.zoom - b.zoom) < 0.05
  );
}

/** Load corners from geo_transform or fall back to NW/SE rectangle. */
export function loadCornersFromMap(m: AnchorMap): GeoCorners | null {
  const tf = parseGeoTransform(m.geo_transform);
  if (tf) return { tl: tf.tl, tr: tf.tr, bl: tf.bl };
  const box = anchorsToSwNe(m);
  return box ? swNeToCorners(box) : null;
}

/** True when at least one site map has walk/PC georef (not the 1-point gps_calibration). */
export function anyMapHasGeoref(
  maps: Array<Pick<AnchorMap, "geo_transform" | "geo_anchor_nw_lat" | "geo_anchor_nw_lng" | "geo_anchor_se_lat" | "geo_anchor_se_lng">> | null | undefined,
): boolean {
  return (maps || []).some((m) => loadCornersFromMap(m) != null);
}

export function viewportCenterCorners(map: L.Map): GeoCorners {
  const b = map.getBounds();
  const c = b.getCenter();
  const latPad = Math.max((b.getNorth() - b.getSouth()) * 0.18, 0.0004);
  const lngPad = Math.max((b.getEast() - b.getWest()) * 0.18, 0.0004);
  return swNeToCorners({
    sw: { lat: c.lat - latPad, lng: c.lng - lngPad },
    ne: { lat: c.lat + latPad, lng: c.lng + lngPad },
  });
}

function rotatePoint(
  p: LatLngLiteral,
  center: LatLngLiteral,
  rad: number,
): LatLngLiteral {
  // Approximate local metric: 1 deg lat ≈ constant; lng scaled by cos(lat)
  const cosLat = Math.cos((center.lat * Math.PI) / 180) || 1e-6;
  const x = (p.lng - center.lng) * cosLat;
  const y = p.lat - center.lat;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const xr = x * cos - y * sin;
  const yr = x * sin + y * cos;
  return {
    lat: center.lat + yr,
    lng: center.lng + xr / cosLat,
  };
}

/** Rotate corners around their center by delta degrees (clockwise positive on map ≈ screen). */
export function rotateCorners(c: GeoCorners, deltaDeg: number): GeoCorners {
  const rad = (-deltaDeg * Math.PI) / 180; // negate so UI “시계방향” matches visual
  const center = cornersCenter(c);
  return {
    tl: rotatePoint(c.tl, center, rad),
    tr: rotatePoint(c.tr, center, rad),
    bl: rotatePoint(c.bl, center, rad),
  };
}

export function scaleCorners(c: GeoCorners, factor: number): GeoCorners {
  const center = cornersCenter(c);
  const scale = (p: LatLngLiteral): LatLngLiteral => ({
    lat: center.lat + (p.lat - center.lat) * factor,
    lng: center.lng + (p.lng - center.lng) * factor,
  });
  return { tl: scale(c.tl), tr: scale(c.tr), bl: scale(c.bl) };
}

export function translateCorners(c: GeoCorners, dLat: number, dLng: number): GeoCorners {
  const move = (p: LatLngLiteral): LatLngLiteral => ({
    lat: p.lat + dLat,
    lng: p.lng + dLng,
  });
  return { tl: move(c.tl), tr: move(c.tr), bl: move(c.bl) };
}

export function swNeToLeafletBounds(b: SwNeBounds): L.LatLngBoundsExpression {
  return [
    [b.sw.lat, b.sw.lng],
    [b.ne.lat, b.ne.lng],
  ];
}

export function swNeToAnchorPayload(b: SwNeBounds) {
  return {
    geo_anchor_nw_lat: b.ne.lat,
    geo_anchor_nw_lng: b.sw.lng,
    geo_anchor_se_lat: b.sw.lat,
    geo_anchor_se_lng: b.ne.lng,
  };
}

export function viewportCenterBounds(map: L.Map): SwNeBounds {
  return cornersToSwNe(viewportCenterCorners(map));
}

export function normalizeSwNe(sw: LatLngLiteral, ne: LatLngLiteral): SwNeBounds {
  return {
    sw: { lat: Math.min(sw.lat, ne.lat), lng: Math.min(sw.lng, ne.lng) },
    ne: { lat: Math.max(sw.lat, ne.lat), lng: Math.max(sw.lng, ne.lng) },
  };
}
