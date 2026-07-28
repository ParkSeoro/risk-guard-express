import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  ImageOverlay,
  Polygon,
  Circle,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import LeafletDrawControl, { type DrawnShape } from "@/components/geofence/LeafletDrawControl";
import type { GeoCorners } from "@/lib/mapBounds";
import {
  crsCircleToGeo,
  crsPolygonToGeo,
  geoCircleToCrs,
  geoPolygonToCrs,
  imageCrsBounds,
} from "@/lib/tracking/imageSpaceGeo";

export type OrthogonalZone = {
  id: string;
  name: string;
  geometry_type: "polygon" | "radius";
  geo_polygon: { lat: number; lng: number }[] | null;
  center_lat: number | null;
  center_lng: number | null;
  radius_m: number | null;
  is_active?: boolean;
};

type Props = {
  imageUrl: string;
  corners: GeoCorners;
  zones: OrthogonalZone[];
  pendingGeoShape: GeoDrawnShape | null;
  onGeoShapeCreated: (shape: GeoDrawnShape) => void;
  onFocusZone?: (id: string) => void;
  className?: string;
};

function FitImage({ bounds }: { bounds: L.LatLngBoundsExpression }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds, { padding: [12, 12] });
  }, [map, bounds]);
  return null;
}

function loadImageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 1000, h: img.naturalHeight || 1000 });
    img.onerror = () => reject(new Error("image load failed"));
    img.crossOrigin = "anonymous";
    img.src = url;
  });
}

/**
 * CRS.Simple orthogonal drone canvas for zone drawing (no satellite, no rotation).
 * Drawn CRS coordinates are inverse-projected to WGS84 via geo_transform corners.
 */
export default function OrthogonalZoneCanvas({
  imageUrl,
  corners,
  zones,
  pendingGeoShape,
  onGeoShapeCreated,
  onFocusZone,
  className,
}: Props) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSize(null);
    loadImageSize(imageUrl)
      .then((s) => {
        if (!cancelled) setSize(s);
      })
      .catch(() => {
        if (!cancelled) setSize({ w: 2000, h: 1500 });
      });
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  const bounds = useMemo(
    () => (size ? imageCrsBounds(size.w, size.h) : null),
    [size],
  );

  const onCrsShape = useCallback(
    (shape: DrawnShape) => {
      if (!size) return;
      if (shape.kind === "polygon") {
        const latlngs = crsPolygonToGeo(shape.latlngs, corners, size.w, size.h);
        onGeoShapeCreated({ kind: "polygon", latlngs });
        return;
      }
      const geo = crsCircleToGeo(shape.center, shape.radius_m, corners, size.w, size.h);
      onGeoShapeCreated({
        kind: "circle",
        center: geo.center,
        radius_m: geo.radius_m,
      });
    },
    [corners, onGeoShapeCreated, size],
  );

  if (!size || !bounds) {
    return (
      <div className={`flex items-center justify-center bg-muted/40 text-sm text-muted-foreground ${className || ""}`}>
        도면 로딩 중…
      </div>
    );
  }

  const crsPending =
    pendingGeoShape?.kind === "polygon"
      ? {
          kind: "polygon" as const,
          ring: geoPolygonToCrs(pendingGeoShape.latlngs, corners, size.w, size.h),
        }
      : pendingGeoShape?.kind === "circle"
        ? {
            kind: "circle" as const,
            ...geoCircleToCrs(
              pendingGeoShape.center,
              pendingGeoShape.radius_m,
              corners,
              size.w,
              size.h,
            ),
          }
        : null;

  return (
    <div className={`relative z-0 bg-neutral-900 ${className || ""}`}>
      <MapContainer
        key={`${imageUrl}-${size.w}x${size.h}`}
        crs={L.CRS.Simple}
        center={[size.h / 2, size.w / 2]}
        zoom={-1}
        minZoom={-3}
        maxZoom={4}
        className="h-full w-full"
        scrollWheelZoom
        attributionControl={false}
        maxBounds={bounds}
        maxBoundsViscosity={0.85}
      >
        <ImageOverlay url={imageUrl} bounds={bounds} opacity={1} />
        <FitImage bounds={bounds} />
        <LeafletDrawControl onShapeCreated={onCrsShape} position="topleft" enabled />

        {crsPending?.kind === "polygon" && (
          <Polygon
            positions={crsPending.ring.map((p) => [p.lat, p.lng] as [number, number])}
            pathOptions={{ color: "#f59e0b", weight: 2, dashArray: "6 4" }}
          />
        )}
        {crsPending?.kind === "circle" && (
          <Circle
            center={[crsPending.center.lat, crsPending.center.lng]}
            radius={crsPending.radius}
            pathOptions={{ color: "#f59e0b", weight: 2, dashArray: "6 4", fillOpacity: 0.15 }}
          />
        )}

        {zones.map((z) => {
          const active = z.is_active !== false;
          const color = active ? "#ef4444" : "#94a3b8";
          if (
            z.geometry_type === "radius" &&
            z.center_lat != null &&
            z.center_lng != null &&
            z.radius_m
          ) {
            const c = geoCircleToCrs(
              { lat: z.center_lat, lng: z.center_lng },
              Number(z.radius_m),
              corners,
              size.w,
              size.h,
            );
            return (
              <Circle
                key={z.id}
                center={[c.center.lat, c.center.lng]}
                radius={c.radius}
                pathOptions={{ color, fillOpacity: active ? 0.2 : 0.08, weight: active ? 2 : 1 }}
                eventHandlers={{ click: () => onFocusZone?.(z.id) }}
              />
            );
          }
          if (z.geo_polygon && z.geo_polygon.length >= 3) {
            const ring = geoPolygonToCrs(z.geo_polygon, corners, size.w, size.h);
            return (
              <Polygon
                key={z.id}
                positions={ring.map((p) => [p.lat, p.lng] as [number, number])}
                pathOptions={{ color, fillOpacity: active ? 0.2 : 0.08, weight: active ? 2 : 1 }}
                eventHandlers={{ click: () => onFocusZone?.(z.id) }}
              />
            );
          }
          return null;
        })}
      </MapContainer>
      <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded-md bg-background/90 px-2 py-1 text-[10px] text-muted-foreground shadow">
        평면 도면 (CRS.Simple) · 위성/회전 없음 · 확대·패닝 자유
      </div>
    </div>
  );
}
