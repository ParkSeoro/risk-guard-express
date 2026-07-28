import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet-draw";

export type DrawnPolygon = {
  kind: "polygon";
  latlngs: { lat: number; lng: number }[];
};

export type DrawnCircle = {
  kind: "circle";
  center: { lat: number; lng: number };
  radius_m: number;
};

export type DrawnShape = DrawnPolygon | DrawnCircle;

type Props = {
  onShapeCreated?: (shape: DrawnShape) => void;
  /** @deprecated prefer onShapeCreated — still works for polygon-only callers */
  onPolygonCreated?: (latlngs: { lat: number; lng: number }[]) => void;
  position?: "topleft" | "topright" | "bottomleft" | "bottomright";
  enabled?: boolean;
};

/**
 * leaflet-draw polygon + circle control bound to the react-leaflet map instance.
 */
export default function LeafletDrawControl({
  onShapeCreated,
  onPolygonCreated,
  position = "topleft",
  enabled = true,
}: Props) {
  const map = useMap();

  useEffect(() => {
    if (!enabled) return;
    if (!onShapeCreated && !onPolygonCreated) return;

    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const DrawControl = (L as any).Control.Draw;
    const drawControl = new DrawControl({
      position,
      draw: {
        polygon: {
          allowIntersection: false,
          showArea: true,
          shapeOptions: { color: "#ef4444", weight: 2, fillOpacity: 0.25 },
        },
        circle: {
          shapeOptions: { color: "#ef4444", weight: 2, fillOpacity: 0.25 },
        },
        polyline: false,
        rectangle: false,
        marker: false,
        circlemarker: false,
      },
      edit: {
        featureGroup: drawnItems,
        remove: true,
      },
    });
    map.addControl(drawControl);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onCreated = (e: any) => {
      const layer = e.layer;
      drawnItems.clearLayers();
      drawnItems.addLayer(layer);

      if (layer instanceof L.Circle || e.layerType === "circle") {
        const c = layer.getLatLng();
        const r = typeof layer.getRadius === "function" ? layer.getRadius() : 0;
        if (r > 0) {
          const shape: DrawnCircle = {
            kind: "circle",
            center: { lat: c.lat, lng: c.lng },
            radius_m: Math.round(r * 10) / 10,
          };
          onShapeCreated?.(shape);
        }
        return;
      }

      const rings = layer.getLatLngs();
      const ring = Array.isArray(rings[0]) ? rings[0] : rings;
      const latlngs = (ring as L.LatLng[]).map((p) => ({ lat: p.lat, lng: p.lng }));
      if (latlngs.length >= 3) {
        onShapeCreated?.({ kind: "polygon", latlngs });
        onPolygonCreated?.(latlngs);
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on((L as any).Draw.Event.CREATED, onCreated);

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.off((L as any).Draw.Event.CREATED, onCreated);
      map.removeControl(drawControl);
      map.removeLayer(drawnItems);
    };
  }, [map, onShapeCreated, onPolygonCreated, position, enabled]);

  return null;
}
