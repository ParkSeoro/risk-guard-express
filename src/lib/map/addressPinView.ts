/** Fallback camera when the site-control map has no georeferenced drawing. */

export const ADDRESS_PIN_VIEW_ZOOM = 16;
/** Same ballpark as the tracking fence — a lot, not a building. */
export const ADDRESS_PIN_RADIUS_M = 500;
export const ADDRESS_PIN_MAX_ZOOM = 16;
export const ADDRESS_PIN_ZONES_MAX_ZOOM = 17;

export type AddressPin = {
  lat: number;
  lng: number;
  address?: string | null;
};

export function parseProjectAddressPin(
  row: {
    site_lat?: number | string | null;
    site_lng?: number | string | null;
    site_address?: string | null;
  } | null | undefined,
): AddressPin | null {
  if (!row) return null;
  if (row.site_lat == null || row.site_lng == null || row.site_lat === "" || row.site_lng === "") {
    return null;
  }
  const lat = Number(row.site_lat);
  const lng = Number(row.site_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  const address = typeof row.site_address === "string" ? row.site_address.trim() : "";
  return { lat, lng, address: address || null };
}

export function hasGeoreferencedDrawing(
  map: { image_url?: string | null } | null | undefined,
  corners: unknown,
): boolean {
  return !!(map?.image_url && corners);
}

export type AddressPinFitSpec =
  | { mode: "none" }
  | { mode: "zones"; maxZoom: number }
  | { mode: "pin"; radiusM: number; maxZoom: number }
  | { mode: "pin+zones"; radiusM: number; maxZoom: number };

/** Camera policy for the empty-drawing satellite fallback. Never a geofence. */
export function addressPinFitSpec(opts: {
  pin: AddressPin | null;
  zoneCount: number;
}): AddressPinFitSpec {
  if (opts.pin && opts.zoneCount > 0) {
    return { mode: "pin+zones", radiusM: ADDRESS_PIN_RADIUS_M, maxZoom: ADDRESS_PIN_ZONES_MAX_ZOOM };
  }
  if (opts.pin) {
    return { mode: "pin", radiusM: ADDRESS_PIN_RADIUS_M, maxZoom: ADDRESS_PIN_MAX_ZOOM };
  }
  if (opts.zoneCount > 0) {
    return { mode: "zones", maxZoom: ADDRESS_PIN_ZONES_MAX_ZOOM };
  }
  return { mode: "none" };
}

/** ~radiusM box around the address pin (equirectangular). */
export function addressPinBounds(pin: AddressPin, radiusM: number): {
  south: number;
  west: number;
  north: number;
  east: number;
} {
  const dLat = radiusM / 111_195;
  const cos = Math.cos((pin.lat * Math.PI) / 180);
  const dLng = radiusM / (111_195 * Math.max(0.2, cos));
  return {
    south: pin.lat - dLat,
    west: pin.lng - dLng,
    north: pin.lat + dLat,
    east: pin.lng + dLng,
  };
}
