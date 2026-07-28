/**
 * Shared helpers: site_maps NW/SE anchors ↔ Leaflet SW/NE bounds.
 */
import L from "leaflet";

export type AnchorMap = {
  geo_anchor_nw_lat: number | null;
  geo_anchor_nw_lng: number | null;
  geo_anchor_se_lat: number | null;
  geo_anchor_se_lng: number | null;
};

export type SwNeBounds = {
  sw: { lat: number; lng: number };
  ne: { lat: number; lng: number };
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

export function swNeToLeafletBounds(b: SwNeBounds): L.LatLngBoundsExpression {
  return [
    [b.sw.lat, b.sw.lng],
    [b.ne.lat, b.ne.lng],
  ];
}

/** Persist as NW / SE columns on site_maps. */
export function swNeToAnchorPayload(b: SwNeBounds) {
  return {
    geo_anchor_nw_lat: b.ne.lat,
    geo_anchor_nw_lng: b.sw.lng,
    geo_anchor_se_lat: b.sw.lat,
    geo_anchor_se_lng: b.ne.lng,
  };
}

/** ~40% of current viewport centered — used when a drone image has no anchors yet. */
export function viewportCenterBounds(map: L.Map): SwNeBounds {
  const b = map.getBounds();
  const c = b.getCenter();
  const latPad = Math.max((b.getNorth() - b.getSouth()) * 0.18, 0.0004);
  const lngPad = Math.max((b.getEast() - b.getWest()) * 0.18, 0.0004);
  return {
    sw: { lat: c.lat - latPad, lng: c.lng - lngPad },
    ne: { lat: c.lat + latPad, lng: c.lng + lngPad },
  };
}

export function normalizeSwNe(sw: { lat: number; lng: number }, ne: { lat: number; lng: number }): SwNeBounds {
  return {
    sw: { lat: Math.min(sw.lat, ne.lat), lng: Math.min(sw.lng, ne.lng) },
    ne: { lat: Math.max(sw.lat, ne.lat), lng: Math.max(sw.lng, ne.lng) },
  };
}
