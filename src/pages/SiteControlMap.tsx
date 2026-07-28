import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  ImageOverlay,
  Polygon,
  Circle,
  Marker,
  Polyline,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Map, Upload, Save, Loader2, Layers, Satellite, Image as ImageIcon, ShieldAlert, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import LeafletDrawControl from "@/components/geofence/LeafletDrawControl";
import {
  anchorsToSwNe,
  normalizeSwNe,
  swNeToAnchorPayload,
  swNeToLeafletBounds,
  viewportCenterBounds,
  type SwNeBounds,
} from "@/lib/mapBounds";

type SiteMap = {
  id: string;
  name: string;
  image_url: string | null;
  project_id: string;
  geo_anchor_nw_lat: number | null;
  geo_anchor_nw_lng: number | null;
  geo_anchor_se_lat: number | null;
  geo_anchor_se_lng: number | null;
};

type Zone = {
  id: string;
  name: string;
  geometry_type: "polygon" | "radius";
  geo_polygon: { lat: number; lng: number }[] | null;
  center_lat: number | null;
  center_lng: number | null;
  radius_m: number | null;
};

type LayerState = {
  satellite: boolean;
  drone: boolean;
  zones: boolean;
};

function boundsMarkerIcon(label: string, color: string) {
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

const SW_ICON = boundsMarkerIcon("SW · 남서", "#2563eb");
const NE_ICON = boundsMarkerIcon("NE · 북동", "#dc2626");

// Neutralize leaflet-div-icon chrome around our custom HTML labels
if (typeof document !== "undefined" && !document.getElementById("site-control-bounds-css")) {
  const style = document.createElement("style");
  style.id = "site-control-bounds-css";
  style.textContent = `
    .site-control-bounds-marker { background: transparent !important; border: none !important; }
  `;
  document.head.appendChild(style);
}

/** Auto-zoom camera to image or zone extents — only when `token` changes (not while dragging). */
function FitToTargets({
  imageBounds,
  zones,
  enabled,
  token,
}: {
  imageBounds: L.LatLngBoundsExpression | null;
  zones: Zone[];
  enabled: boolean;
  token: string;
}) {
  const map = useMap();
  const imageRef = useRef(imageBounds);
  const zonesRef = useRef(zones);
  imageRef.current = imageBounds;
  zonesRef.current = zones;

  useEffect(() => {
    if (!enabled) return;
    const parts: L.LatLngBoundsExpression[] = [];
    if (imageRef.current) parts.push(imageRef.current);
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
      map.fitBounds(union, { padding: [40, 40], maxZoom: 19 });
    }
  }, [map, enabled, token]);
  return null;
}

/** Expose map instance + seed viewport bounds after drone upload. */
function MapBridge({
  onMap,
  seedRequest,
  onSeedBounds,
}: {
  onMap: (map: L.Map) => void;
  seedRequest: number;
  onSeedBounds: (b: SwNeBounds) => void;
}) {
  const map = useMap();
  useEffect(() => {
    onMap(map);
  }, [map, onMap]);

  useEffect(() => {
    if (!seedRequest) return;
    onSeedBounds(viewportCenterBounds(map));
  }, [seedRequest, map, onSeedBounds]);

  useMapEvents({});
  return null;
}

/** Draggable SW / NE markers → live ImageOverlay resize. */
function VisualBoundsMarkers({
  bounds,
  onChange,
  visible,
}: {
  bounds: SwNeBounds;
  onChange: (b: SwNeBounds) => void;
  visible: boolean;
}) {
  if (!visible) return null;

  return (
    <>
      <Polyline
        positions={[
          [bounds.sw.lat, bounds.sw.lng],
          [bounds.sw.lat, bounds.ne.lng],
          [bounds.ne.lat, bounds.ne.lng],
          [bounds.ne.lat, bounds.sw.lng],
          [bounds.sw.lat, bounds.sw.lng],
        ]}
        pathOptions={{ color: "#38bdf8", weight: 1.5, dashArray: "4 4", opacity: 0.9 }}
      />
      <Marker
        position={[bounds.sw.lat, bounds.sw.lng]}
        draggable
        icon={SW_ICON}
        eventHandlers={{
          drag: (e) => {
            const ll = (e.target as L.Marker).getLatLng();
            onChange(normalizeSwNe({ lat: ll.lat, lng: ll.lng }, bounds.ne));
          },
          dragend: (e) => {
            const ll = (e.target as L.Marker).getLatLng();
            onChange(normalizeSwNe({ lat: ll.lat, lng: ll.lng }, bounds.ne));
          },
        }}
      />
      <Marker
        position={[bounds.ne.lat, bounds.ne.lng]}
        draggable
        icon={NE_ICON}
        eventHandlers={{
          drag: (e) => {
            const ll = (e.target as L.Marker).getLatLng();
            onChange(normalizeSwNe(bounds.sw, { lat: ll.lat, lng: ll.lng }));
          },
          dragend: (e) => {
            const ll = (e.target as L.Marker).getLatLng();
            onChange(normalizeSwNe(bounds.sw, { lat: ll.lat, lng: ll.lng }));
          },
        }}
      />
    </>
  );
}

/**
 * 통합 현장 관제맵 — 위성 + 드론 오버레이 + 위험구역 (레이어 토글).
 * Visual georef: SW/NE 드래그 마커로 ImageOverlay bounds 실시간 조정.
 */
export default function SiteControlMap() {
  const [projectId, setProjectId] = useState(() => localStorage.getItem("currentProjectId") || "");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [maps, setMaps] = useState<SiteMap[]>([]);
  const [activeMap, setActiveMap] = useState<SiteMap | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [draftName, setDraftName] = useState("위험구역");
  const [pendingPoly, setPendingPoly] = useState<{ lat: number; lng: number }[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingBounds, setSavingBounds] = useState(false);

  const [draftBounds, setDraftBounds] = useState<SwNeBounds | null>(null);
  const [layers, setLayers] = useState<LayerState>({
    satellite: true,
    drone: true,
    zones: true,
  });
  const [fitToken, setFitToken] = useState("init");
  const [seedRequest, setSeedRequest] = useState(0);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    supabase
      .from("projects")
      .select("id,name")
      .eq("is_deleted", false)
      .then(({ data }) => setProjects(data || []));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    localStorage.setItem("currentProjectId", projectId);
    void loadMaps();
    void loadZones();
  }, [projectId]);

  // Sync draft bounds when switching maps
  useEffect(() => {
    if (!activeMap) {
      setDraftBounds(null);
      return;
    }
    const existing = anchorsToSwNe(activeMap);
    if (existing) {
      setDraftBounds(existing);
      setFitToken(`map-${activeMap.id}-${Date.now()}`);
    } else if (activeMap.image_url) {
      // No anchors yet → seed from current viewport once map is ready
      setSeedRequest((n) => n + 1);
    } else {
      setDraftBounds(null);
    }
  }, [activeMap?.id]);

  const loadMaps = async () => {
    const { data } = await supabase
      .from("site_maps")
      .select("id,name,image_url,project_id,geo_anchor_nw_lat,geo_anchor_nw_lng,geo_anchor_se_lat,geo_anchor_se_lng")
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false });
    const list = (data || []) as SiteMap[];
    setMaps(list);
    if (list.length && (!activeMap || activeMap.project_id !== projectId)) {
      setActiveMap(list[0]);
    }
    if (!list.length) setActiveMap(null);
  };

  const loadZones = async () => {
    const { data } = await supabase
      .from("restricted_zones")
      .select("id,name,geometry_type,geo_polygon,center_lat,center_lng,radius_m")
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .eq("is_active", true);
    const list = (data || []) as unknown as Zone[];
    setZones(list);
    if (list.length) setFitToken(`zones-${Date.now()}`);
  };

  const leafletBounds = useMemo(
    () => (draftBounds ? swNeToLeafletBounds(draftBounds) : null),
    [draftBounds],
  );

  const onMapReady = useCallback((map: L.Map) => {
    mapRef.current = map;
  }, []);

  const onSeedBounds = useCallback((b: SwNeBounds) => {
    setDraftBounds(b);
    setFitToken(`seed-${Date.now()}`);
  }, []);

  const onUploadDrone = async (file: File) => {
    if (!projectId) {
      toast.error("프로젝트를 먼저 선택하세요");
      return;
    }
    setUploading(true);
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${projectId}/drone-maps/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("attachments")
      .upload(path, file, { upsert: false, contentType: file.type });
    if (upErr) {
      setUploading(false);
      toast.error("업로드 실패: " + upErr.message);
      return;
    }
    const { data: pub } = supabase.storage.from("attachments").getPublicUrl(path);
    const name = file.name.replace(/\.[^.]+$/, "") || "드론 현장사진";
    const { data, error } = await supabase
      .from("site_maps")
      .insert({
        project_id: projectId,
        name,
        image_url: pub.publicUrl,
        created_by: (await supabase.auth.getUser()).data.user?.id,
      } as any)
      .select("id,name,image_url,project_id,geo_anchor_nw_lat,geo_anchor_nw_lng,geo_anchor_se_lat,geo_anchor_se_lng")
      .single();
    setUploading(false);
    if (error) {
      toast.error("맵 등록 실패: " + error.message);
      return;
    }
    toast.success("드론 사진 업로드 완료 — SW/NE 마커를 드래그해 위치를 맞추세요");
    setLayers((l) => ({ ...l, drone: true }));
    setActiveMap(data as SiteMap);
    // Seed markers at viewport center (MapBridge reacts to seedRequest)
    setSeedRequest((n) => n + 1);
    void loadMaps();
  };

  const saveBounds = async () => {
    if (!activeMap || !draftBounds) return;
    setSavingBounds(true);
    const payload = swNeToAnchorPayload(draftBounds);
    const { error } = await supabase.from("site_maps").update(payload).eq("id", activeMap.id);
    setSavingBounds(false);
    if (error) {
      toast.error("Bounds 저장 실패: " + error.message);
      return;
    }
    toast.success("드론 사진 Bounds가 저장되었습니다");
    setActiveMap({ ...activeMap, ...payload });
    setFitToken(`saved-${Date.now()}`);
    void loadMaps();
  };

  const onPolygonCreated = useCallback((latlngs: { lat: number; lng: number }[]) => {
    setPendingPoly(latlngs);
    setLayers((l) => ({ ...l, zones: true }));
    toast.message(`다각형 ${latlngs.length}점 — 이름 확인 후 저장하세요`);
  }, []);

  const savePolygonZone = async () => {
    if (!projectId || !pendingPoly || pendingPoly.length < 3) {
      toast.error("먼저 지도에서 다각형을 그려주세요");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("restricted_zones").insert({
      project_id: projectId,
      name: draftName.trim() || "위험구역",
      geometry_type: "polygon",
      geo_polygon: pendingPoly,
      center_lat: null,
      center_lng: null,
      radius_m: null,
      banned_worker_ids: [],
      banned_company_ids: [],
      banned_job_types: [],
      is_active: true,
      created_by: (await supabase.auth.getUser()).data.user?.id,
    } as any);
    setSaving(false);
    if (error) {
      toast.error("저장 실패: " + error.message);
      return;
    }
    toast.success("위험 구역이 저장되었습니다");
    setPendingPoly(null);
    void loadZones();
  };

  const deleteZone = async (id: string) => {
    const { error } = await supabase
      .from("restricted_zones")
      .update({ is_deleted: true } as any)
      .eq("id", id);
    if (error) {
      toast.error("삭제 실패: " + error.message);
      return;
    }
    toast.success("구역이 삭제되었습니다");
    void loadZones();
  };

  const center: [number, number] = draftBounds
    ? [
        (draftBounds.sw.lat + draftBounds.ne.lat) / 2,
        (draftBounds.sw.lng + draftBounds.ne.lng) / 2,
      ]
    : [37.5665, 126.978];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Map className="h-6 w-6 text-primary" />
            통합 현장 관제맵
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            위성 · 드론 오버레이 · 위험구역을 한 화면에서 제어합니다. SW/NE 마커를 드래그해 사진을 맞추세요.
          </p>
        </div>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="프로젝트 선택" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid lg:grid-cols-[300px_1fr] gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">드론 · 위험구역</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">맵 선택</Label>
              <Select
                value={activeMap?.id || ""}
                onValueChange={(id) => setActiveMap(maps.find((m) => m.id === id) || null)}
              >
                <SelectTrigger><SelectValue placeholder="맵 선택" /></SelectTrigger>
                <SelectContent>
                  {maps.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <label className="flex items-center justify-center gap-2 h-11 border border-dashed rounded-md cursor-pointer text-sm hover:bg-muted/50">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              드론 사진 업로드
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onUploadDrone(f);
                  e.target.value = "";
                }}
              />
            </label>

            {draftBounds && activeMap?.image_url && (
              <div className="rounded-md border bg-muted/40 p-2.5 space-y-2">
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  지도 위 <b>SW·NE 마커</b>를 드래그하면 드론 사진이 실시간으로 리사이즈됩니다.
                  좌표 수동 입력은 없습니다.
                </p>
                <div className="grid grid-cols-2 gap-1 text-[10px] font-mono text-muted-foreground">
                  <span>SW {draftBounds.sw.lat.toFixed(5)}, {draftBounds.sw.lng.toFixed(5)}</span>
                  <span className="text-right">NE {draftBounds.ne.lat.toFixed(5)}, {draftBounds.ne.lng.toFixed(5)}</span>
                </div>
                <Button className="w-full" size="sm" onClick={() => void saveBounds()} disabled={savingBounds}>
                  {savingBounds ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                  Bounds 저장
                </Button>
              </div>
            )}

            <div className="border-t pt-3 space-y-2">
              <Label className="text-xs">새 위험구역 이름</Label>
              <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} />
              {pendingPoly && (
                <Badge variant="outline">{pendingPoly.length}점 다각형 대기</Badge>
              )}
              <Button className="w-full" onClick={() => void savePolygonZone()} disabled={saving || !pendingPoly}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                위험구역 저장
              </Button>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                지도 좌측 상단 다각형 도구로 구역을 그린 뒤 저장하세요.
              </p>
            </div>

            <div className="text-xs text-muted-foreground space-y-1 max-h-48 overflow-auto">
              <div className="font-medium text-foreground">등록 구역 {zones.length}</div>
              {zones.map((z) => (
                <div key={z.id} className="flex items-center justify-between gap-2 py-0.5">
                  <span className="truncate">{z.name}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <Badge variant="secondary" className="text-[10px]">
                      {z.geometry_type === "radius" ? `원 ${z.radius_m}m` : "폴리곤"}
                    </Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive"
                      onClick={() => void deleteZone(z.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="h-[70vh] min-h-[420px] w-full relative z-0">
              {/* Layer control — top right */}
              <div className="absolute top-3 right-3 z-[1000] w-52 rounded-lg border bg-background/95 shadow-md p-3 space-y-2.5 backdrop-blur-sm">
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <Layers className="h-3.5 w-3.5" /> 레이어
                </div>
                <label className="flex items-center justify-between gap-2 text-xs cursor-pointer">
                  <span className="flex items-center gap-1.5">
                    <Satellite className="h-3.5 w-3.5 text-muted-foreground" /> 위성 베이스맵
                  </span>
                  <Switch
                    checked={layers.satellite}
                    onCheckedChange={(v) => setLayers((l) => ({ ...l, satellite: v }))}
                  />
                </label>
                <label className="flex items-center justify-between gap-2 text-xs cursor-pointer">
                  <span className="flex items-center gap-1.5">
                    <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" /> 드론 오버레이
                  </span>
                  <Switch
                    checked={layers.drone}
                    onCheckedChange={(v) => setLayers((l) => ({ ...l, drone: v }))}
                  />
                </label>
                <label className="flex items-center justify-between gap-2 text-xs cursor-pointer">
                  <span className="flex items-center gap-1.5">
                    <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" /> 위험구역
                  </span>
                  <Switch
                    checked={layers.zones}
                    onCheckedChange={(v) => setLayers((l) => ({ ...l, zones: v }))}
                  />
                </label>
              </div>

              <MapContainer
                center={center}
                zoom={17}
                className="h-full w-full"
                scrollWheelZoom
              >
                {layers.satellite ? (
                  <TileLayer
                    attribution='&copy; Esri'
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                  />
                ) : (
                  <TileLayer
                    attribution='&copy; OpenStreetMap'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                )}

                <MapBridge
                  onMap={onMapReady}
                  seedRequest={seedRequest}
                  onSeedBounds={onSeedBounds}
                />

                {layers.drone && activeMap?.image_url && leafletBounds && (
                  <ImageOverlay
                    url={activeMap.image_url}
                    bounds={leafletBounds}
                    opacity={0.85}
                    zIndex={200}
                  />
                )}

                {layers.drone && draftBounds && activeMap?.image_url && (
                  <VisualBoundsMarkers
                    bounds={draftBounds}
                    onChange={setDraftBounds}
                    visible
                  />
                )}

                <FitToTargets
                  imageBounds={layers.drone ? leafletBounds : null}
                  zones={layers.zones ? zones : []}
                  enabled
                  token={fitToken}
                />

                {layers.zones && (
                  <LeafletDrawControl onPolygonCreated={onPolygonCreated} position="topleft" />
                )}

                {layers.zones && pendingPoly && (
                  <Polygon
                    positions={pendingPoly.map((p) => [p.lat, p.lng] as [number, number])}
                    pathOptions={{ color: "#f59e0b", weight: 2, dashArray: "6 4" }}
                  />
                )}

                {layers.zones &&
                  zones.map((z) =>
                    z.geometry_type === "radius" &&
                    z.center_lat != null &&
                    z.center_lng != null &&
                    z.radius_m ? (
                      <Circle
                        key={z.id}
                        center={[z.center_lat, z.center_lng]}
                        radius={Number(z.radius_m)}
                        pathOptions={{ color: "#ef4444", fillOpacity: 0.2 }}
                      />
                    ) : z.geo_polygon && z.geo_polygon.length >= 3 ? (
                      <Polygon
                        key={z.id}
                        positions={z.geo_polygon.map((p) => [p.lat, p.lng] as [number, number])}
                        pathOptions={{ color: "#ef4444", fillOpacity: 0.2 }}
                      />
                    ) : null,
                  )}
              </MapContainer>

              {activeMap?.image_url && !draftBounds && (
                <div className="absolute inset-x-0 bottom-3 mx-auto max-w-md rounded-lg bg-background/95 border p-3 text-xs text-center shadow z-[500]">
                  뷰포트 중앙에 SW/NE 마커를 배치하는 중…
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
