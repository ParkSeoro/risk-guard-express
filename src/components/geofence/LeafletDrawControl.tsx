import { useEffect, useRef } from "react";
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
  /** For CRS.Simple maps this is map-units; callers convert to meters. */
  radius_m: number;
};

export type DrawnShape = DrawnPolygon | DrawnCircle;

export type DrawTool = "polygon" | "rectangle" | "circle";

type Props = {
  onShapeCreated?: (shape: DrawnShape) => void;
  /** @deprecated prefer onShapeCreated */
  onPolygonCreated?: (latlngs: { lat: number; lng: number }[]) => void;
  enabled?: boolean;
  /** When set, programmatically enable that draw handler (no default toolbar). */
  activeTool?: DrawTool | null;
  drawColor?: string;
  /** Called after a shape is finished (or cancelled) so parent can clear activeTool. */
  onToolFinished?: () => void;
  /**
   * If true, also mount the default leaflet-draw toolbar (legacy).
   * Default false — custom external buttons drive drawing.
   */
  showToolbar?: boolean;
  position?: "topleft" | "topright" | "bottomleft" | "bottomright";
};

function applyKoreanDrawTooltips() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const local = (L as any).drawLocal;
  if (!local?.draw?.handlers) return;
  local.draw.handlers.polygon = {
    ...local.draw.handlers.polygon,
    tooltip: {
      start: "클릭하여 첫 꼭짓점을 찍으세요",
      cont: "클릭할 때마다 꼭짓점이 추가됩니다",
      end: "더블클릭하면 닫히며(Finish) 완료됩니다",
    },
  };
  local.draw.handlers.rectangle = {
    ...local.draw.handlers.rectangle,
    tooltip: {
      start: "클릭·드래그로 사각형을 그리세요",
    },
  };
  local.draw.handlers.circle = {
    ...local.draw.handlers.circle,
    tooltip: {
      start: "클릭·드래그로 원형을 그리세요",
    },
  };
}

/**
 * Headless / optional-toolbar Leaflet Draw bridge.
 * Prefer activeTool + external UI buttons over the default Control.Draw icons.
 */
export default function LeafletDrawControl({
  onShapeCreated,
  onPolygonCreated,
  enabled = true,
  activeTool = null,
  drawColor = "#ef4444",
  onToolFinished,
  showToolbar = false,
  position = "topleft",
}: Props) {
  const map = useMap();
  const handlerRef = useRef<{ disable: () => void } | null>(null);
  const draggingWasEnabled = useRef(true);

  // While an external draw tool is active, block map panning so draw clicks/drags win.
  useEffect(() => {
    if (!enabled || showToolbar) return;
    if (activeTool) {
      draggingWasEnabled.current = map.dragging.enabled();
      map.dragging.disable();
      map.doubleClickZoom?.disable?.();
      map.boxZoom?.disable?.();
      return () => {
        if (draggingWasEnabled.current) map.dragging.enable();
        map.doubleClickZoom?.enable?.();
        map.boxZoom?.enable?.();
      };
    }
    map.dragging.enable();
    map.doubleClickZoom?.enable?.();
    map.boxZoom?.enable?.();
  }, [map, enabled, showToolbar, activeTool]);

  // Optional legacy toolbar
  useEffect(() => {
    if (!enabled || !showToolbar) return;
    if (!onShapeCreated && !onPolygonCreated) return;

    applyKoreanDrawTooltips();

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
          shapeOptions: { color: drawColor, weight: 2, fillOpacity: 0.25 },
        },
        rectangle: {
          shapeOptions: { color: drawColor, weight: 2, fillOpacity: 0.25 },
        },
        circle: {
          shapeOptions: { color: drawColor, weight: 2, fillOpacity: 0.25 },
        },
        polyline: false,
        marker: false,
        circlemarker: false,
      },
      edit: { featureGroup: drawnItems, remove: true },
    });
    map.addControl(drawControl);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onCreated = (e: any) => {
      emitShape(e, drawnItems, onShapeCreated, onPolygonCreated);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on((L as any).Draw.Event.CREATED, onCreated);

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.off((L as any).Draw.Event.CREATED, onCreated);
      map.removeControl(drawControl);
      map.removeLayer(drawnItems);
    };
  }, [map, onShapeCreated, onPolygonCreated, position, enabled, showToolbar, drawColor]);

  // Programmatic draw via activeTool (no toolbar)
  useEffect(() => {
    if (!enabled || showToolbar) return;
    if (!activeTool) {
      handlerRef.current?.disable();
      handlerRef.current = null;
      return;
    }
    if (!onShapeCreated && !onPolygonCreated) return;

    applyKoreanDrawTooltips();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Draw = (L as any).Draw;
    const shapeOptions = { color: drawColor, weight: 2, fillOpacity: 0.25 };
    let handler: { enable: () => void; disable: () => void };

    if (activeTool === "polygon") {
      handler = new Draw.Polygon(map, {
        allowIntersection: false,
        showArea: false,
        shapeOptions,
      });
    } else if (activeTool === "rectangle") {
      handler = new Draw.Rectangle(map, { shapeOptions });
    } else {
      handler = new Draw.Circle(map, { shapeOptions });
    }

    handlerRef.current = handler;
    handler.enable();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onCreated = (e: any) => {
      emitShape(e, null, onShapeCreated, onPolygonCreated);
      handler.disable();
      handlerRef.current = null;
      onToolFinished?.();
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onDrawStop = () => {
      // Esc / finish without create also clears tool
      if (handlerRef.current === handler) {
        handlerRef.current = null;
        onToolFinished?.();
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on((L as any).Draw.Event.CREATED, onCreated);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on((L as any).Draw.Event.DRAWSTOP, onDrawStop);

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.off((L as any).Draw.Event.CREATED, onCreated);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.off((L as any).Draw.Event.DRAWSTOP, onDrawStop);
      try {
        handler.disable();
      } catch {
        /* ignore */
      }
      if (handlerRef.current === handler) handlerRef.current = null;
    };
  }, [
    map,
    enabled,
    showToolbar,
    activeTool,
    drawColor,
    onShapeCreated,
    onPolygonCreated,
    onToolFinished,
  ]);

  return null;
}

function emitShape(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  e: any,
  drawnItems: L.FeatureGroup | null,
  onShapeCreated?: (shape: DrawnShape) => void,
  onPolygonCreated?: (latlngs: { lat: number; lng: number }[]) => void,
) {
  const layer = e.layer;
  if (drawnItems) {
    drawnItems.clearLayers();
    drawnItems.addLayer(layer);
  }

  if (layer instanceof L.Circle || e.layerType === "circle") {
    const c = layer.getLatLng();
    const r = typeof layer.getRadius === "function" ? layer.getRadius() : 0;
    if (r > 0) {
      onShapeCreated?.({
        kind: "circle",
        center: { lat: c.lat, lng: c.lng },
        radius_m: Math.round(r * 10) / 10,
      });
    }
    return;
  }

  // polygon or rectangle → latlng ring
  let latlngs: { lat: number; lng: number }[] = [];
  if (e.layerType === "rectangle" || layer instanceof L.Rectangle) {
    const b = layer.getBounds?.();
    if (b) {
      const sw = b.getSouthWest();
      const ne = b.getNorthEast();
      latlngs = [
        { lat: ne.lat, lng: sw.lng },
        { lat: ne.lat, lng: ne.lng },
        { lat: sw.lat, lng: ne.lng },
        { lat: sw.lat, lng: sw.lng },
      ];
    }
  } else {
    const rings = layer.getLatLngs();
    const ring = Array.isArray(rings[0]) ? rings[0] : rings;
    latlngs = (ring as L.LatLng[]).map((p) => ({ lat: p.lat, lng: p.lng }));
  }

  if (latlngs.length >= 3) {
    onShapeCreated?.({ kind: "polygon", latlngs });
    onPolygonCreated?.(latlngs);
  }
}
