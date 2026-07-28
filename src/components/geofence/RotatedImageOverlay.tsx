import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet-imageoverlay-rotated";
import type { GeoCorners } from "@/lib/mapBounds";

type Props = {
  url: string;
  corners: GeoCorners;
  opacity?: number;
};

type RotatedOverlay = L.ImageOverlay & {
  reposition: (tl: L.LatLngExpression, tr: L.LatLngExpression, bl: L.LatLngExpression) => void;
};

/**
 * react-leaflet wrapper for L.ImageOverlay.Rotated (3-corner affine transform).
 */
export default function RotatedImageOverlay({ url, corners, opacity = 0.85 }: Props) {
  const map = useMap();
  const overlayRef = useRef<RotatedOverlay | null>(null);

  useEffect(() => {
    const factory = (L as typeof L & {
      imageOverlay: typeof L.imageOverlay & {
        rotated: (
          url: string,
          tl: L.LatLngExpression,
          tr: L.LatLngExpression,
          bl: L.LatLngExpression,
          opts?: L.ImageOverlayOptions,
        ) => RotatedOverlay;
      };
    }).imageOverlay.rotated;

    const overlay = factory(
      url,
      [corners.tl.lat, corners.tl.lng],
      [corners.tr.lat, corners.tr.lng],
      [corners.bl.lat, corners.bl.lng],
      { opacity, interactive: false },
    );
    overlay.addTo(map);
    overlayRef.current = overlay;
    return () => {
      map.removeLayer(overlay);
      overlayRef.current = null;
    };
    // Recreate only when URL changes; corners/opacity update via effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, url]);

  useEffect(() => {
    overlayRef.current?.reposition(
      [corners.tl.lat, corners.tl.lng],
      [corners.tr.lat, corners.tr.lng],
      [corners.bl.lat, corners.bl.lng],
    );
  }, [corners.tl.lat, corners.tl.lng, corners.tr.lat, corners.tr.lng, corners.bl.lat, corners.bl.lng]);

  useEffect(() => {
    overlayRef.current?.setOpacity(opacity);
  }, [opacity]);

  return null;
}
