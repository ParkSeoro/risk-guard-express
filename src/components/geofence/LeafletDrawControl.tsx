import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet-draw";

type Props = {
  onPolygonCreated: (latlngs: { lat: number; lng: number }[]) => void;
  /** leaflet-draw control position. Default topleft (topright reserved for layer panel). */
  position?: "topleft" | "topright" | "bottomleft" | "bottomright";
};

/**
 * leaflet-draw polygon control bound to the react-leaflet map instance.
 */
export default function LeafletDrawControl({ onPolygonCreated, position = "topleft" }: Props) {
  const map = useMap();

  useEffect(() => {
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
        polyline: false,
        rectangle: false,
        circle: false,
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
      const rings = layer.getLatLngs();
      const ring = Array.isArray(rings[0]) ? rings[0] : rings;
      const latlngs = (ring as L.LatLng[]).map((p) => ({ lat: p.lat, lng: p.lng }));
      if (latlngs.length >= 3) onPolygonCreated(latlngs);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on((L as any).Draw.Event.CREATED, onCreated);

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.off((L as any).Draw.Event.CREATED, onCreated);
      map.removeControl(drawControl);
      map.removeLayer(drawnItems);
    };
  }, [map, onPolygonCreated, position]);

  return null;
}
