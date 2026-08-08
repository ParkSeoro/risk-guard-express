import { TileLayer } from "react-leaflet";
import {
  VWORLD_ATTR,
  VWORLD_MAX_ZOOM,
  hasVworldKey,
  vworldBaseUrl,
  vworldHybridUrl,
  vworldSatelliteUrl,
} from "@/lib/mapTiles";

type Props = {
  /** true = Satellite + Hybrid labels; false = Base roads */
  satellite?: boolean;
};

/** VWorld WMTS basemap (replaces Esri / OSM). */
export default function VWorldBasemap({ satellite = true }: Props) {
  if (!hasVworldKey()) {
    return (
      <TileLayer
        attribution="VWorld key missing (VITE_VWORLD_API_KEY)"
        url="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
      />
    );
  }

  if (!satellite) {
    return (
      <TileLayer
        attribution={VWORLD_ATTR}
        url={vworldBaseUrl()}
        maxZoom={VWORLD_MAX_ZOOM}
        maxNativeZoom={VWORLD_MAX_ZOOM}
      />
    );
  }

  return (
    <>
      <TileLayer
        attribution={VWORLD_ATTR}
        url={vworldSatelliteUrl()}
        maxZoom={VWORLD_MAX_ZOOM}
        maxNativeZoom={VWORLD_MAX_ZOOM}
      />
      <TileLayer
        attribution=""
        url={vworldHybridUrl()}
        maxZoom={VWORLD_MAX_ZOOM}
        maxNativeZoom={VWORLD_MAX_ZOOM}
        opacity={1}
      />
    </>
  );
}
