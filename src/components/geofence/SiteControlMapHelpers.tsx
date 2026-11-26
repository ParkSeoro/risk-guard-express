import { useEffect, useRef } from "react";
import { Marker, Polyline, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import {
  ADDRESS_PIN_RADIUS_M,
  addressPinBounds,
  type AddressPin,
} from "@/lib/map/addressPinView";
import {
  bottomRight,
  viewportCenterCorners,
  type GeoCorners,
  type SiteMapView,
} from "@/lib/mapBounds";

export type SiteMap = {
  id: string;
  name: string;
  image_url: string | null;
  project_id: string;
  site_spot_id?: string | null;
  geo_anchor_nw_lat: number | null;
  geo_anchor_nw_lng: number | null;
  geo_anchor_se_lat: number | null;
  geo_anchor_se_lng: number | null;
  geo_transform?: unknown;
};

export type Zone = {
  id: string;
  name: string;
  geometry_type: "polygon" | "radius";
  geo_polygon: { lat: number; lng: number }[] | null;
  center_lat: number | null;
  center_lng: number | null;
  radius_m: number | null;
  zone_category?: string | null;
  access_rules?: unknown;
  is_active?: boolean;
  rule_type?: string | null;
  zone_color?: string | null;
  buffer_m?: number | null;
  site_spot_id?: string | null;
};

export type LayerState = {
  satellite: boolean;
  drone: boolean;
  zones: boolean;
  site: boolean;
};

export type PanelTab = "mapping" | "site" | "zones";

export type TwoPointPicks = {
  p1Img?: { lat: number; lng: number };
  p1Sat?: { lat: number; lng: number };
  p2Img?: { lat: number; lng: number };
  p2Sat?: { lat: number; lng: number };
};

export const SITE_OUTLINE_COLOR = "#0f766e";

export function cornerIcon(label: string, color: string) {
  return L.divIcon({
    className: "site-control-bounds-marker",
    html: `<div style="
      background:${color};
      color:#fff;
      font:700 11px/1 system-ui,sans-serif;
      padding:6px 8px;
      border-radius:8px;
      border:2px solid #fff;
      box-shadow:0 2px 8px rgba(0,0,0,.35);
      white-space:nowrap;
      transform:translate(-50%,-50%);
      cursor:grab;
      user-select:none;
    ">${label}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

export const TL_ICON = cornerIcon("TL · 좌상", "#2563eb");
export const TR_ICON = cornerIcon("TR · 우상", "#dc2626");
export const BL_ICON = cornerIcon("BL · 좌하", "#059669");

export const LANDMARK_P1_IMG_ICON = cornerIcon("1 · 도면", "#2563eb");
export const LANDMARK_P1_SAT_ICON = cornerIcon("1 · 위성", "#059669");
export const LANDMARK_P2_IMG_ICON = cornerIcon("2 · 도면", "#9333ea");
export const LANDMARK_P2_SAT_ICON = cornerIcon("2 · 위성", "#ea580c");

export const MY_LOC_ICON = L.divIcon({
  className: "site-control-my-loc",
  html: `<div style="
    width:18px;height:18px;border-radius:50%;
    background:#2563eb;border:3px solid #fff;
    box-shadow:0 0 0 2px rgba(37,99,235,.45),0 2px 8px rgba(0,0,0,.35);
    transform:translate(-50%,-50%);
  "></div>`,
  iconSize: [0, 0],
  iconAnchor: [0, 0],
});

if (typeof document !== "undefined" && !document.getElementById("site-control-bounds-css")) {
  const style = document.createElement("style");
  style.id = "site-control-bounds-css";
  style.textContent = `
    .site-control-bounds-marker { background: transparent !important; border: none !important; }
    .site-control-my-loc { background: transparent !important; border: none !important; }
    .leaflet-draw { display: none !important; }
  `;
  document.head.appendChild(style);
} else if (typeof document !== "undefined") {
  const el = document.getElementById("site-control-bounds-css");
  if (el && !el.textContent?.includes("leaflet-draw")) {
    el.textContent += `\n.leaflet-draw { display: none !important; }`;
  }
}

export function FitToTargets({
  imageBounds,
  zones,
  enabled,
  token,
  savedView,
  sitePin,
  pinRadiusM = ADDRESS_PIN_RADIUS_M,
  maxZoom = 19,
  focusBox = null,
}: {
  imageBounds: L.LatLngBoundsExpression | null;
  zones: Zone[];
  enabled: boolean;
  token: string;
  savedView: SiteMapView | null;
  sitePin?: AddressPin | null;
  pinRadiusM?: number;
  maxZoom?: number;
  focusBox?: { south: number; west: number; north: number; east: number } | null;
}) {
  const map = useMap();
  const imageRef = useRef(imageBounds);
  const zonesRef = useRef(zones);
  const viewRef = useRef(savedView);
  const pinRef = useRef(sitePin);
  const focusRef = useRef(focusBox);
  imageRef.current = imageBounds;
  zonesRef.current = zones;
  viewRef.current = savedView;
  pinRef.current = sitePin;
  focusRef.current = focusBox;

  useEffect(() => {
    if (!enabled) return;
    const focus = focusRef.current;
    if (focus) {
      map.fitBounds(
        [
          [focus.south, focus.west],
          [focus.north, focus.east],
        ],
        { padding: [40, 40], maxZoom },
      );
      return;
    }
    const view = viewRef.current;
    // Saved overlay view only applies when a drawing is on the map.
    if (view && !pinRef.current) {
      map.setView([view.lat, view.lng], view.zoom, { animate: false });
      return;
    }
    const parts: L.LatLngBoundsExpression[] = [];
    if (imageRef.current) parts.push(imageRef.current);
    const pin = pinRef.current;
    if (pin) {
      const box = addressPinBounds(pin, pinRadiusM);
      parts.push([
        [box.south, box.west],
        [box.north, box.east],
      ]);
    }
    for (const z of zonesRef.current) {
      if (z.geometry_type === "radius" && z.center_lat != null && z.center_lng != null && z.radius_m) {
        const c = L.latLng(z.center_lat, z.center_lng);
        parts.push(c.toBounds(Number(z.radius_m) * 2.2));
      } else if (z.geo_polygon && z.geo_polygon.length >= 3) {
        parts.push(L.latLngBounds(z.geo_polygon.map((p) => [p.lat, p.lng] as [number, number])));
      }
    }
    if (!parts.length) return;
    let union = L.latLngBounds(parts[0] as L.LatLngBoundsExpression);
    for (let i = 1; i < parts.length; i++) {
      union = union.extend(parts[i] as L.LatLngBoundsExpression);
    }
    if (union.isValid()) {
      map.fitBounds(union, { padding: [40, 40], maxZoom });
    }
  }, [map, enabled, token, pinRadiusM, maxZoom]);
  return null;
}

export function MapViewSync({
  enabled,
  onView,
}: {
  enabled: boolean;
  onView: (view: SiteMapView) => void;
}) {
  const map = useMap();
  useEffect(() => {
    if (!enabled) return;
    const handler = () => {
      const c = map.getCenter();
      onView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
    };
    map.on("moveend", handler);
    return () => {
      map.off("moveend", handler);
    };
  }, [map, enabled, onView]);
  return null;
}

export function MapBridge({
  onMap,
  seedRequest,
  onSeedCorners,
}: {
  onMap: (map: L.Map) => void;
  seedRequest: number;
  onSeedCorners: (c: GeoCorners) => void;
}) {
  const map = useMap();
  useEffect(() => {
    onMap(map);
  }, [map, onMap]);

  useEffect(() => {
    if (!seedRequest) return;
    onSeedCorners(viewportCenterCorners(map));
  }, [seedRequest, map, onSeedCorners]);

  useMapEvents({});
  return null;
}

/** 3 draggable corners → live rotated/skewed overlay. */
export function VisualCornerMarkers({
  corners,
  onChange,
  visible,
}: {
  corners: GeoCorners;
  onChange: (c: GeoCorners) => void;
  visible: boolean;
}) {
  if (!visible) return null;
  const br = bottomRight(corners);

  return (
    <>
      <Polyline
        positions={[
          [corners.tl.lat, corners.tl.lng],
          [corners.tr.lat, corners.tr.lng],
          [br.lat, br.lng],
          [corners.bl.lat, corners.bl.lng],
          [corners.tl.lat, corners.tl.lng],
        ]}
        pathOptions={{ color: "#38bdf8", weight: 1.5, dashArray: "4 4", opacity: 0.9 }}
      />
      <Marker
        position={[corners.tl.lat, corners.tl.lng]}
        draggable
        icon={TL_ICON}
        eventHandlers={{
          drag: (e) => {
            const ll = (e.target as L.Marker).getLatLng();
            onChange({ ...corners, tl: { lat: ll.lat, lng: ll.lng } });
          },
          dragend: (e) => {
            const ll = (e.target as L.Marker).getLatLng();
            onChange({ ...corners, tl: { lat: ll.lat, lng: ll.lng } });
          },
        }}
      />
      <Marker
        position={[corners.tr.lat, corners.tr.lng]}
        draggable
        icon={TR_ICON}
        eventHandlers={{
          drag: (e) => {
            const ll = (e.target as L.Marker).getLatLng();
            onChange({ ...corners, tr: { lat: ll.lat, lng: ll.lng } });
          },
          dragend: (e) => {
            const ll = (e.target as L.Marker).getLatLng();
            onChange({ ...corners, tr: { lat: ll.lat, lng: ll.lng } });
          },
        }}
      />
      <Marker
        position={[corners.bl.lat, corners.bl.lng]}
        draggable
        icon={BL_ICON}
        eventHandlers={{
          drag: (e) => {
            const ll = (e.target as L.Marker).getLatLng();
            onChange({ ...corners, bl: { lat: ll.lat, lng: ll.lng } });
          },
          dragend: (e) => {
            const ll = (e.target as L.Marker).getLatLng();
            onChange({ ...corners, bl: { lat: ll.lat, lng: ll.lng } });
          },
        }}
      />
    </>
  );
}

export function readImageAspectRatio(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || typeof Image === "undefined") {
      resolve(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const ratio = img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : undefined;
      URL.revokeObjectURL(url);
      resolve(ratio);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    };
    img.src = url;
  });
}

export function TwoPointClickCapture({
  active,
  onPick,
}: {
  active: boolean;
  onPick: (pt: { lat: number; lng: number }) => void;
}) {
  useMapEvents({
    click(e) {
      if (!active) return;
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}
