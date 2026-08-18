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

export type GeoTransform = GeoCorners & {
  opacity?: number;
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

/** Persist NW/SE bbox (legacy) + full 3-corner transform. */
export function cornersToPersistPayload(c: GeoCorners, opacity = 0.85) {
  const box = cornersToSwNe(c);
  return {
    geo_anchor_nw_lat: box.ne.lat,
    geo_anchor_nw_lng: box.sw.lng,
    geo_anchor_se_lat: box.sw.lat,
    geo_anchor_se_lng: box.ne.lng,
    geo_transform: {
      tl: c.tl,
      tr: c.tr,
      bl: c.bl,
      opacity,
    } satisfies GeoTransform,
  };
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
  return {
    tl: { lat: tl.lat, lng: tl.lng },
    tr: { lat: tr.lat, lng: tr.lng },
    bl: { lat: bl.lat, lng: bl.lng },
    opacity: typeof o.opacity === "number" ? o.opacity : 0.85,
  };
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
