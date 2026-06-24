// Point-in-polygon (ray casting). Polygon is an array of {lat,lng} or {x,y}.
export function pointInPolygon(
  point: { x: number; y: number },
  poly: { x: number; y: number }[]
): boolean {
  if (!poly || poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      (yi > point.y) !== (yj > point.y) &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Convert lat/lng polygon (array of {lat,lng}) to xy for the algorithm above. */
export function findZoneByLatLng(
  lat: number,
  lng: number,
  zones: { id: string; geo_polygon: { lat: number; lng: number }[] | null }[]
): string | null {
  for (const z of zones) {
    const poly = z.geo_polygon;
    if (!poly || poly.length < 3) continue;
    const xy = poly.map((p) => ({ x: p.lng, y: p.lat }));
    if (pointInPolygon({ x: lng, y: lat }, xy)) return z.id;
  }
  return null;
}

/** Derive a lat/lng polygon from a normalized (0..1) polygon plus the map's NW/SE anchors. */
export function projectPolygonToGeo(
  normalized: { x: number; y: number }[],
  anchors: { nw_lat: number; nw_lng: number; se_lat: number; se_lng: number }
): { lat: number; lng: number }[] {
  const { nw_lat, nw_lng, se_lat, se_lng } = anchors;
  // x=0 -> nw_lng, x=1 -> se_lng ; y=0 -> nw_lat (top), y=1 -> se_lat (bottom)
  return normalized.map((p) => ({
    lat: nw_lat + (se_lat - nw_lat) * p.y,
    lng: nw_lng + (se_lng - nw_lng) * p.x,
  }));
}
