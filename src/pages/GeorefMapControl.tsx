import { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, ImageOverlay, Polygon, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import VWorldBasemap from "@/components/geofence/VWorldBasemap";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Map, Upload, Save, Crosshair, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useActiveProject } from "@/hooks/useActiveProject";
import LeafletDrawControl from "@/components/geofence/LeafletDrawControl";
import {
  formatGpsPreview,
  GPS_COORDS_INVALID_MSG,
  looksLikeWgs84Ring,
} from "@/lib/tracking/imageSpaceGeo";

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

/** Convert stored NW/SE anchors → Leaflet ImageOverlay bounds [[south,west],[north,east]]. */
function anchorsToBounds(m: SiteMap): L.LatLngBoundsExpression | null {
  if (
    m.geo_anchor_nw_lat == null ||
    m.geo_anchor_nw_lng == null ||
    m.geo_anchor_se_lat == null ||
    m.geo_anchor_se_lng == null
  ) {
    return null;
  }
  const south = Math.min(m.geo_anchor_nw_lat, m.geo_anchor_se_lat);
  const north = Math.max(m.geo_anchor_nw_lat, m.geo_anchor_se_lat);
  const west = Math.min(m.geo_anchor_nw_lng, m.geo_anchor_se_lng);
  const east = Math.max(m.geo_anchor_nw_lng, m.geo_anchor_se_lng);
  return [
    [south, west],
    [north, east],
  ];
}

function FitBounds({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    map.fitBounds(bounds as L.LatLngBoundsExpression, { padding: [24, 24] });
  }, [map, bounds]);
  return null;
}

/**
 * PC/tablet: satellite basemap + georeferenced drone image overlay + polygon draw → restricted_zones.
 */
export default function GeorefMapControl() {
  const { projectId, setProjectId } = useActiveProject();
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [maps, setMaps] = useState<SiteMap[]>([]);
  const [activeMap, setActiveMap] = useState<SiteMap | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [draftName, setDraftName] = useState("위험구역");
  const [pendingPoly, setPendingPoly] = useState<{ lat: number; lng: number }[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // SW / NE form (user-facing) — stored as NW/SE on site_maps
  const [swLat, setSwLat] = useState("");
  const [swLng, setSwLng] = useState("");
  const [neLat, setNeLat] = useState("");
  const [neLng, setNeLng] = useState("");

  useEffect(() => {
    supabase
      .from("projects")
      .select("id,name")
      .eq("is_deleted", false)
      .then(({ data }) => setProjects(data || []));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    loadMaps();
    loadZones();
  }, [projectId]);

  useEffect(() => {
    if (!activeMap) return;
    // Prefill SW/NE from NW/SE
    if (activeMap.geo_anchor_nw_lat != null && activeMap.geo_anchor_se_lat != null) {
      const south = Math.min(activeMap.geo_anchor_nw_lat, activeMap.geo_anchor_se_lat);
      const north = Math.max(activeMap.geo_anchor_nw_lat, activeMap.geo_anchor_se_lat);
      const west = Math.min(activeMap.geo_anchor_nw_lng!, activeMap.geo_anchor_se_lng!);
      const east = Math.max(activeMap.geo_anchor_nw_lng!, activeMap.geo_anchor_se_lng!);
      setSwLat(String(south));
      setSwLng(String(west));
      setNeLat(String(north));
      setNeLng(String(east));
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
  };

  const loadZones = async () => {
    const { data } = await supabase
      .from("restricted_zones")
      .select("id,name,geometry_type,geo_polygon,center_lat,center_lng,radius_m")
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .eq("is_active", true);
    setZones((data || []) as unknown as Zone[]);
  };

  const bounds = useMemo(() => (activeMap ? anchorsToBounds(activeMap) : null), [activeMap]);

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
    toast.success("드론 사진이 업로드되었습니다. SW/NE 좌표를 입력하세요.");
    setActiveMap(data as SiteMap);
    loadMaps();
  };

  const saveBounds = async () => {
    if (!activeMap) return;
    const sw_lat = Number(swLat);
    const sw_lng = Number(swLng);
    const ne_lat = Number(neLat);
    const ne_lng = Number(neLng);
    if (![sw_lat, sw_lng, ne_lat, ne_lng].every(Number.isFinite)) {
      toast.error("SW/NE 위·경도를 올바르게 입력하세요");
      return;
    }
    if (sw_lat >= ne_lat || sw_lng >= ne_lng) {
      toast.error("SW는 남서, NE는 북동이어야 합니다 (위도/경도 크기 확인)");
      return;
    }
    // Persist as NW / SE (existing site_maps schema)
    const payload = {
      geo_anchor_nw_lat: ne_lat,
      geo_anchor_nw_lng: sw_lng,
      geo_anchor_se_lat: sw_lat,
      geo_anchor_se_lng: ne_lng,
    };
    const { error } = await supabase.from("site_maps").update(payload).eq("id", activeMap.id);
    if (error) {
      toast.error("좌표 저장 실패: " + error.message);
      return;
    }
    toast.success("드론 사진 GPS Bounds가 저장되었습니다");
    setActiveMap({ ...activeMap, ...payload });
    loadMaps();
  };

  const onPolygonCreated = useCallback((latlngs: { lat: number; lng: number }[]) => {
    if (!looksLikeWgs84Ring(latlngs)) {
      toast.error(GPS_COORDS_INVALID_MSG);
      setPendingPoly(null);
      return;
    }
    setPendingPoly(latlngs);
    toast.message(`다각형 ${latlngs.length}점 작성됨 — 이름을 확인하고 저장하세요`);
  }, []);

  const savePolygonZone = async () => {
    if (!projectId || !pendingPoly || pendingPoly.length < 3) {
      toast.error("먼저 지도에서 다각형을 그려주세요");
      return;
    }
    if (!looksLikeWgs84Ring(pendingPoly)) {
      toast.error(GPS_COORDS_INVALID_MSG);
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
    toast.success("위험 구역(Polygon)이 저장되었습니다");
    setPendingPoly(null);
    loadZones();
  };

  const center: [number, number] = bounds
    ? [
        ((bounds as number[][])[0][0] + (bounds as number[][])[1][0]) / 2,
        ((bounds as number[][])[0][1] + (bounds as number[][])[1][1]) / 2,
      ]
    : [37.5665, 126.978];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Map className="h-6 w-6 text-primary" />
            드론 Georeferencing 관제
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            위성 지도 위에 드론 사진을 SW/NE Bounds로 오버레이하고, 다각형으로 위험구역을 그립니다.
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

      <div className="grid lg:grid-cols-[320px_1fr] gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">드론 사진 · Bounds</CardTitle>
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
                  if (f) onUploadDrone(f);
                  e.target.value = "";
                }}
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">SW 위도</Label>
                <Input value={swLat} onChange={(e) => setSwLat(e.target.value)} placeholder="남" className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">SW 경도</Label>
                <Input value={swLng} onChange={(e) => setSwLng(e.target.value)} placeholder="서" className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">NE 위도</Label>
                <Input value={neLat} onChange={(e) => setNeLat(e.target.value)} placeholder="북" className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">NE 경도</Label>
                <Input value={neLng} onChange={(e) => setNeLng(e.target.value)} placeholder="동" className="h-9" />
              </div>
            </div>
            <Button className="w-full" variant="secondary" onClick={saveBounds} disabled={!activeMap}>
              <Crosshair className="h-4 w-4 mr-1" /> Bounds 저장
            </Button>

            <div className="border-t pt-3 space-y-2">
              <Label className="text-xs">새 위험구역 이름</Label>
              <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} />
              {pendingPoly && (
                <>
                  <Badge variant="outline">{pendingPoly.length}점 다각형 대기</Badge>
                  <p className="text-[10px] leading-relaxed text-muted-foreground break-all">
                    {formatGpsPreview({ kind: "polygon", latlngs: pendingPoly })}
                  </p>
                </>
              )}
              <Button className="w-full" onClick={savePolygonZone} disabled={saving || !pendingPoly}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                Polygon → restricted_zones 저장
              </Button>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                지도 우측 상단 다각형 도구로 드론 사진 위에 구역을 그린 뒤 저장하세요.
              </p>
            </div>

            <div className="text-xs text-muted-foreground space-y-1 max-h-40 overflow-auto">
              <div className="font-medium text-foreground">등록 구역 {zones.length}</div>
              {zones.map((z) => (
                <div key={z.id} className="flex justify-between gap-2">
                  <span className="truncate">{z.name}</span>
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {z.geometry_type === "radius" ? `원 ${z.radius_m}m` : "폴리곤"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="h-[70vh] min-h-[420px] w-full relative z-0">
              <MapContainer
                center={center}
                zoom={17}
                maxZoom={19}
                className="h-full w-full"
                scrollWheelZoom
              >
                <VWorldBasemap satellite />
                {activeMap?.image_url && bounds && (
                  <ImageOverlay url={activeMap.image_url} bounds={bounds} opacity={0.85} />
                )}
                <FitBounds bounds={bounds} />
                {bounds && (
                  <LeafletDrawControl
                    showToolbar
                    onPolygonCreated={onPolygonCreated}
                  />
                )}
                {pendingPoly && (
                  <Polygon
                    positions={pendingPoly.map((p) => [p.lat, p.lng] as [number, number])}
                    pathOptions={{ color: "#f59e0b", weight: 2, dashArray: "6 4" }}
                  />
                )}
                {zones.map((z) =>
                  z.geometry_type === "radius" && z.center_lat != null && z.center_lng != null && z.radius_m ? (
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
                  ) : null
                )}
              </MapContainer>
              {!bounds && activeMap && (
                <div className="absolute inset-x-0 bottom-3 mx-auto max-w-md rounded-lg bg-background/95 border p-3 text-xs text-center shadow z-[500]">
                  SW/NE Bounds를 저장해야 드론 사진이 지도에 오버레이됩니다.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
