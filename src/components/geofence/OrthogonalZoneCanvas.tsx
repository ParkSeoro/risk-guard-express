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
import LeafletDrawControl, {
  type DrawnShape,
  type DrawTool,
} from "@/components/geofence/LeafletDrawControl";
import type { GeoCorners } from "@/lib/mapBounds";
import {
  crsCircleToGeo,
  crsPolygonToGeo,
  geoCircleToCrs,
  geoPolygonToCrs,
  imageCrsBounds,
  latLngToUv,
  looksLikeWgs84,
  looksLikeWgs84Ring,
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
  zone_color?: string | null;
};

type Props = {
  imageUrl: string;
  /** Mapping-tab GPS corners (geo_transform TL/TR/BL or NW/SE). */
  corners: GeoCorners;
  zones: OrthogonalZone[];
  pendingGeoShape: DrawnShape | null;
  pendingColor?: string;
  activeTool?: DrawTool | null;
  drawColor?: string;
  onToolFinished?: () => void;
  onGeoShapeCreated: (shape: DrawnShape) => void;
  onFocusZone?: (id: string) => void;
  /** When set, fly the CRS canvas to this zone id. */
  focusZoneId?: string | null;
  className?: string;
};

/** True when zone center (or first polygon vertex) projects outside the drone image UV. */
export function isZoneOffImage(
  z: Pick<OrthogonalZone, "geometry_type" | "center_lat" | "center_lng" | "geo_polygon">,
  corners: GeoCorners,
): boolean {
  const pt =
    z.geometry_type === "radius" && z.center_lat != null && z.center_lng != null
      ? { lat: z.center_lat, lng: z.center_lng }
      : z.geo_polygon?.[0];
  if (!pt) return false;
  const uv = latLngToUv(pt, corners);
  return uv.u < -0.02 || uv.u > 1.02 || uv.v < -0.02 || uv.v > 1.02;
}

function FitImage({ bounds }: { bounds: L.LatLngBoundsExpression }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds, { padding: [12, 12] });
  }, [map, bounds]);
  return null;
}

function FocusCrsZone({
  zoneId,
  zones,
  corners,
  size,
}: {
  zoneId: string | null | undefined;
  zones: OrthogonalZone[];
  corners: GeoCorners;
  size: { w: number; h: number };
}) {
  const map = useMap();
  useEffect(() => {
    if (!zoneId) return;
    const z = zones.find((x) => x.id === zoneId);
    if (!z) return;
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
      const pad = Math.max(c.radius * 1.6, 40);
      map.fitBounds(
        L.latLngBounds(
          [c.center.lat - pad, c.center.lng - pad],
          [c.center.lat + pad, c.center.lng + pad],
        ),
        { padding: [24, 24], maxZoom: 3 },
      );
      return;
    }
    if (z.geo_polygon && z.geo_polygon.length >= 3) {
      const ring = geoPolygonToCrs(z.geo_polygon, corners, size.w, size.h);
      map.fitBounds(
        L.latLngBounds(ring.map((p) => [p.lat, p.lng] as [number, number])),
        { padding: [24, 24], maxZoom: 3 },
      );
    }
  }, [zoneId, zones, corners, size, map]);
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
 * Drawing is driven by external activeTool buttons (no default leaflet-draw toolbar).
 * draw:created CRS pixel rings are inverse-mapped to WGS84 via mapping GPS bounds.
 */
export default function OrthogonalZoneCanvas({
  imageUrl,
  corners,
  zones,
  pendingGeoShape,
  pendingColor = "#f59e0b",
  activeTool = null,
  drawColor = "#ef4444",
  onToolFinished,
  onGeoShapeCreated,
  onFocusZone,
  focusZoneId,
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

  const imageBounds = useMemo(
    () => (size ? imageCrsBounds(size.w, size.h) : null),
    [size],
  );

  /** Expand pan range so Walk&Drop / off-image GPS circles remain reachable. */
  const maxBounds = useMemo(() => {
    if (!size || !imageBounds) return null;
    let minLat = 0;
    let minLng = 0;
    let maxLat = size.h;
    let maxLng = size.w;
    const expand = (lat: number, lng: number, r = 0) => {
      minLat = Math.min(minLat, lat - r);
      maxLat = Math.max(maxLat, lat + r);
      minLng = Math.min(minLng, lng - r);
      maxLng = Math.max(maxLng, lng + r);
    };
    for (const z of zones) {
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
        expand(c.center.lat, c.center.lng, c.radius * 1.2);
      } else if (z.geo_polygon && z.geo_polygon.length >= 3) {
        for (const p of geoPolygonToCrs(z.geo_polygon, corners, size.w, size.h)) {
          expand(p.lat, p.lng, 20);
        }
      }
    }
    const pad = Math.max(size.w, size.h) * 0.15;
    return L.latLngBounds(
      [minLat - pad, minLng - pad],
      [maxLat + pad, maxLng + pad],
    );
  }, [size, imageBounds, zones, corners]);

  const offImageCount = useMemo(() => {
    if (!size) return 0;
    return zones.filter((z) => isZoneOffImage(z, corners)).length;
  }, [zones, corners, size]);

  const onCrsShape = useCallback(
    (shape: DrawnShape) => {
      if (!size) return;
      if (shape.kind === "polygon") {
        const latlngs = crsPolygonToGeo(shape.latlngs, corners, size.w, size.h);
        if (!looksLikeWgs84Ring(latlngs)) {
          console.error("[OrthogonalZoneCanvas] GPS inverse failed", {
            crs: shape.latlngs,
            geo: latlngs,
            corners,
            size,
          });
          return;
        }
        onGeoShapeCreated({ kind: "polygon", latlngs });
        return;
      }
      const geo = crsCircleToGeo(shape.center, shape.radius_m, corners, size.w, size.h);
      if (!looksLikeWgs84(geo.center)) {
        console.error("[OrthogonalZoneCanvas] circle GPS inverse failed", {
          crs: shape.center,
          geo,
          corners,
          size,
        });
        return;
      }
      onGeoShapeCreated({
        kind: "circle",
        center: geo.center,
        radius_m: geo.radius_m,
      });
    },
    [corners, onGeoShapeCreated, size],
  );

  if (!size || !imageBounds || !maxBounds) {
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

  const guideText =
    activeTool === "polygon"
      ? "다각형: 클릭할 때마다 꼭짓점(Vertex)이 찍히고, 더블클릭 시 닫히며(Finish) 완료됩니다. · 지도 이동(Panning) 일시 차단"
      : activeTool === "rectangle"
        ? "사각형: 클릭 후 드래그로 영역을 지정하세요. · 지도 이동(Panning) 일시 차단"
        : activeTool === "circle"
          ? "원형: 중심을 클릭한 뒤 드래그로 반경을 지정하세요. · 지도 이동(Panning) 일시 차단"
          : null;

  return (
    <div className={`relative z-0 bg-neutral-900 ${className || ""}`}>
      {guideText && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-[1100] w-[min(92%,28rem)] -translate-x-1/2 rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-center text-[11px] font-medium text-amber-950 shadow-md dark:bg-amber-950/90 dark:text-amber-50">
          {guideText}
        </div>
      )}
      {offImageCount > 0 && (
        <div className="pointer-events-none absolute top-3 right-3 z-[1100] max-w-[14rem] rounded-md border border-amber-500/50 bg-amber-50/95 px-2.5 py-1.5 text-[10px] text-amber-950 shadow dark:bg-amber-950/90 dark:text-amber-50">
          도면 밖 구역 {offImageCount}개 — 목록에서 선택하거나 맵핑 탭 위성에서 확인. 모바일
          Walk&amp;Drop은 GPS 보정 후 재등록하세요.
        </div>
      )}
      <MapContainer
        key={`${imageUrl}-${size.w}x${size.h}`}
        crs={L.CRS.Simple}
        center={[size.h / 2, size.w / 2]}
        zoom={-1}
        minZoom={-4}
        maxZoom={5}
        className="h-full w-full"
        scrollWheelZoom
        attributionControl={false}
        maxBounds={maxBounds}
        maxBoundsViscosity={0.6}
      >
        <ImageOverlay url={imageUrl} bounds={imageBounds} opacity={1} />
        <FitImage bounds={imageBounds} />
        <FocusCrsZone zoneId={focusZoneId} zones={zones} corners={corners} size={size} />
        <LeafletDrawControl
          showToolbar={false}
          enabled
          activeTool={activeTool}
          drawColor={drawColor}
          onShapeCreated={onCrsShape}
          onToolFinished={onToolFinished}
        />

        {crsPending?.kind === "polygon" && (
          <Polygon
            positions={crsPending.ring.map((p) => [p.lat, p.lng] as [number, number])}
            pathOptions={{ color: pendingColor, weight: 2, dashArray: "6 4" }}
          />
        )}
        {crsPending?.kind === "circle" && (
          <Circle
            center={[crsPending.center.lat, crsPending.center.lng]}
            radius={crsPending.radius}
            pathOptions={{ color: pendingColor, weight: 2, dashArray: "6 4", fillOpacity: 0.15 }}
          />
        )}

        {zones.map((z) => {
          const active = z.is_active !== false;
          const off = isZoneOffImage(z, corners);
          const color = active ? (z.zone_color || (off ? "#f97316" : "#ef4444")) : "#94a3b8";
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
                pathOptions={{
                  color,
                  fillOpacity: active ? 0.2 : 0.08,
                  weight: active ? 2 : 1,
                  dashArray: off ? "4 3" : undefined,
                }}
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
                pathOptions={{
                  color,
                  fillOpacity: active ? 0.2 : 0.08,
                  weight: active ? 2 : 1,
                  dashArray: off ? "4 3" : undefined,
                }}
                eventHandlers={{ click: () => onFocusZone?.(z.id) }}
              />
            );
          }
          return null;
        })}
      </MapContainer>
      <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded-md bg-background/90 px-2 py-1 text-[10px] text-muted-foreground shadow">
        평면 도면 (CRS.Simple) · 픽셀→WGS84 역산 · 좌측 버튼으로 그리기
      </div>
    </div>
  );
}
