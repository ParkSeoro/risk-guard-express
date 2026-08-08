/**
 * Basemap tile URLs — VWorld (국토교통부) WMTS.
 * Leaflet template: path uses {z}/{y}/{x} (VWorld order).
 * Key: VITE_VWORLD_API_KEY (client-visible; restrict by domain in VWorld console).
 */

export const VWORLD_ATTR =
  '&copy; <a href="https://www.vworld.kr/" target="_blank" rel="noreferrer">VWorld</a> 국토교통부';

export function getVworldApiKey(): string {
  return (import.meta.env.VITE_VWORLD_API_KEY as string | undefined)?.trim() || "";
}

export function hasVworldKey(): boolean {
  return getVworldApiKey().length > 0;
}

function wmtsUrl(layer: "Satellite" | "Base" | "Hybrid", ext: "jpeg" | "png"): string {
  const key = getVworldApiKey();
  return `https://api.vworld.kr/req/wmts/1.0.0/${key}/${layer}/{z}/{y}/{x}.${ext}`;
}

/** Aerial imagery (default for site control / georef). */
export function vworldSatelliteUrl(): string {
  return wmtsUrl("Satellite", "jpeg");
}

/** Road / labels basemap. */
export function vworldBaseUrl(): string {
  return wmtsUrl("Base", "png");
}

/** Transparent labels/roads over Satellite. */
export function vworldHybridUrl(): string {
  return wmtsUrl("Hybrid", "png");
}

export const VWORLD_MAX_ZOOM = 19;
