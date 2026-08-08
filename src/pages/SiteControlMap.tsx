import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
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
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Map, Upload, Save, Loader2, Layers, Satellite, Image as ImageIcon, ShieldAlert, Trash2, Pencil,
  RotateCcw, RotateCw, Move, ZoomIn, ZoomOut, ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  Square, Pentagon, Circle as CircleIcon, Crosshair, MapPin,
} from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import ZoneAccessRulesDialog, {
  type ZoneDraftPayload,
  type ZoneEditSeed,
} from "@/components/geofence/ZoneAccessRulesDialog";
import RotatedImageOverlay from "@/components/geofence/RotatedImageOverlay";
import VWorldBasemap from "@/components/geofence/VWorldBasemap";
import OrthogonalZoneCanvas, {
  isZoneOffImage,
} from "@/components/geofence/OrthogonalZoneCanvas";
import { fetchProjectCompanies } from "@/lib/projectCompanies";
import {
  applyGpsCalibration,
  clearGpsCalibrationCache,
  fetchProjectGpsCalibration,
  offsetMagnitudeM,
  type GpsCalibration,
} from "@/lib/tracking/gpsCalibration";
import {
  accessRulesSummary,
  parseAccessRules,
  ruleTypeLabel,
  ZONE_COLOR_OPTIONS,
  zoneCategorySchema,
} from "@/lib/tracking/accessRules";
import type { DrawnShape, DrawTool } from "@/components/geofence/LeafletDrawControl";
import { looksLikeWgs84, looksLikeWgs84Ring, GPS_COORDS_INVALID_MSG } from "@/lib/tracking/imageSpaceGeo";
import {
  bottomRight,
  cornersCenter,
  cornersToLeafletBounds,
  cornersToPersistPayload,
  loadCornersFromMap,
  parseGeoTransform,
  rotateCorners,
  scaleCorners,
  translateCorners,
  viewportCenterCorners,
  type GeoCorners,
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
  geo_transform?: unknown;
};

type Zone = {
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
};

type LayerState = {
  satellite: boolean;
  drone: boolean;
  zones: boolean;
};

type PanelTab = "mapping" | "zones";

function cornerIcon(label: string, color: string) {
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

const TL_ICON = cornerIcon("TL · 좌상", "#2563eb");
const TR_ICON = cornerIcon("TR · 우상", "#dc2626");
const BL_ICON = cornerIcon("BL · 좌하", "#059669");

const MY_LOC_ICON = L.divIcon({
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

function MapBridge({
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
function VisualCornerMarkers({
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

/**
 * 통합 현장 관제맵 — 도면 업로드(기본) → 모바일 워킹 보정.
 * PC 위성 TL/TR/BL은 선택(고급).
 */
export default function SiteControlMap() {
  const [projectId, setProjectId] = useState(() => localStorage.getItem("currentProjectId") || "");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [maps, setMaps] = useState<SiteMap[]>([]);
  const [activeMap, setActiveMap] = useState<SiteMap | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [panelTab, setPanelTab] = useState<PanelTab>("mapping");
  const [pendingShape, setPendingShape] = useState<DrawnShape | null>(null);
  const [editingZone, setEditingZone] = useState<ZoneEditSeed | null>(null);
  const [zoneModalOpen, setZoneModalOpen] = useState(false);
  const [drawTool, setDrawTool] = useState<DrawTool | null>(null);
  const [drawColor, setDrawColor] = useState<string>("#ef4444");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingBounds, setSavingBounds] = useState(false);

  const [draftCorners, setDraftCorners] = useState<GeoCorners | null>(null);
  const [opacity, setOpacity] = useState(0.85);
  const [rotateStep, setRotateStep] = useState(1);
  const [layers, setLayers] = useState<LayerState>({
    satellite: true,
    drone: true,
    zones: true,
  });
  const [fitToken, setFitToken] = useState("init");
  const [seedRequest, setSeedRequest] = useState(0);
  const mapRef = useRef<L.Map | null>(null);
  const [myGps, setMyGps] = useState<{
    lat: number;
    lng: number;
    rawLat: number;
    rawLng: number;
    accuracy: number;
    calibrated?: boolean;
  } | null>(null);
  const [watchingGps, setWatchingGps] = useState(false);
  const gpsWatchRef = useRef<number | null>(null);
  const [gpsCal, setGpsCal] = useState<GpsCalibration | null>(null);
  const [focusZoneId, setFocusZoneId] = useState<string | null>(null);

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
    void fetchProjectCompanies(projectId).then((rows) =>
      setCompanies(rows.map((c) => ({ id: c.id, name: c.name }))),
    );
    void fetchProjectGpsCalibration(projectId, async (id) => {
      const { data } = await supabase
        .from("projects")
        .select("gps_calibration")
        .eq("id", id)
        .maybeSingle();
      return data?.gps_calibration ?? null;
    }).then(setGpsCal);
  }, [projectId]);

  // Tab switch: map tools vs zone tools — keep shared map/layer state, toggle tool visibility only
  useEffect(() => {
    if (panelTab === "zones") {
      setLayers((l) => ({ ...l, zones: true, satellite: false }));
      void loadZones(); // pick up mobile Walk&Drop without full page reload
    } else {
      setLayers((l) => ({ ...l, satellite: true }));
      setDrawTool(null);
      setFocusZoneId(null);
    }
  }, [panelTab]);

  useEffect(() => {
    if (!activeMap) {
      setDraftCorners(null);
      return;
    }
    const existing = loadCornersFromMap(activeMap);
    const tf = parseGeoTransform(activeMap.geo_transform);
    if (tf?.opacity != null) setOpacity(tf.opacity);
    if (existing) {
      setDraftCorners(existing);
      setFitToken(`map-${activeMap.id}-${Date.now()}`);
    } else if (activeMap.image_url) {
      setSeedRequest((n) => n + 1);
    } else {
      setDraftCorners(null);
    }
  }, [activeMap?.id]);

  const loadMaps = async () => {
    const { data } = await supabase
      .from("site_maps")
      .select(
        "id,name,image_url,project_id,geo_anchor_nw_lat,geo_anchor_nw_lng,geo_anchor_se_lat,geo_anchor_se_lng,geo_transform",
      )
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
      .select(
        "id,name,geometry_type,geo_polygon,center_lat,center_lng,radius_m,zone_category,access_rules,is_active,rule_type,zone_color",
      )
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false });
    const list = (data || []) as unknown as Zone[];
    setZones(list);
    if (list.length) setFitToken(`zones-${Date.now()}`);
  };

  const leafletBounds = useMemo(
    () => (draftCorners ? cornersToLeafletBounds(draftCorners) : null),
    [draftCorners],
  );

  const onMapReady = useCallback((map: L.Map) => {
    mapRef.current = map;
  }, []);

  const onSeedCorners = useCallback((c: GeoCorners) => {
    setDraftCorners(c);
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
    const name = file.name.replace(/\.[^.]+$/, "") || "현장 도면";
    const { data, error } = await supabase
      .from("site_maps")
      .insert({
        project_id: projectId,
        name,
        image_url: pub.publicUrl,
        created_by: (await supabase.auth.getUser()).data.user?.id,
      } as any)
      .select(
        "id,name,image_url,project_id,geo_anchor_nw_lat,geo_anchor_nw_lng,geo_anchor_se_lat,geo_anchor_se_lng,geo_transform",
      )
      .single();
    setUploading(false);
    if (error) {
      toast.error("맵 등록 실패: " + error.message);
      return;
    }
    toast.success("업로드 완료 — 모바일 「맵·GPS 맞추기」워킹 보정으로 좌표를 맞추세요", {
      description: "PC 위성 TL/TR/BL 수동 정렬은 선택(고급)입니다.",
      duration: 7000,
    });
    setLayers((l) => ({ ...l, drone: true }));
    setActiveMap(data as SiteMap);
    setSeedRequest((n) => n + 1);
    void loadMaps();
  };

  const saveBounds = async () => {
    if (!activeMap || !draftCorners) return;
    setSavingBounds(true);
    const payload = cornersToPersistPayload(draftCorners, opacity);
    const { error } = await supabase.from("site_maps").update(payload as any).eq("id", activeMap.id);
    if (error) {
      setSavingBounds(false);
      toast.error("저장 실패: " + error.message + " (geo_transform 마이그레이션 적용 여부 확인)");
      return;
    }
    // Georef change invalidates residual phone bias — clear so GPS isn't double-shifted.
    if (projectId) {
      const { error: clearErr } = await supabase
        .from("projects")
        .update({ gps_calibration: null as any })
        .eq("id", projectId);
      if (!clearErr) clearGpsCalibrationCache(projectId);
    }
    setSavingBounds(false);
    toast.success("위성 정렬(고급)이 저장되었습니다", {
      description:
        zones.length > 0
          ? `1점 GPS 보정 초기화 · 위험구역 ${zones.length}개는 좌표가 어긋날 수 있어 다시 그려 주세요.`
          : "1점 GPS 보정은 초기화했습니다. 잔여 오차는 모바일 1점 보정으로.",
      duration: 8000,
    });
    setActiveMap({ ...activeMap, ...payload });
    setFitToken(`saved-${Date.now()}`);
    void loadMaps();
  };

  const onShapeCreated = useCallback((shape: DrawnShape) => {
    setEditingZone(null);
    setPendingShape(shape);
    setDrawTool(null);
    setZoneModalOpen(true);
    setLayers((l) => ({ ...l, zones: true }));
    setPanelTab("zones");
  }, []);

  const openEditZone = (z: Zone) => {
    setPendingShape(null);
    setEditingZone({
      id: z.id,
      name: z.name,
      zone_category: z.zone_category,
      zone_color: z.zone_color,
      rule_type: z.rule_type,
      access_rules: z.access_rules,
    });
    setZoneModalOpen(true);
  };

  const saveZoneFromModal = async (payload: ZoneDraftPayload) => {
    if (!projectId) {
      toast.error("프로젝트를 먼저 선택하세요");
      return;
    }
    const catParsed = zoneCategorySchema.safeParse(payload.zone_category);
    if (!catParsed.success) {
      toast.error("유효한 구역 유형을 선택하세요");
      return;
    }
    setSaving(true);

    // Edit: update attributes only (keep geometry)
    if (payload.zoneId) {
      const { error } = await supabase
        .from("restricted_zones")
        .update({
          name: payload.name,
          zone_category: catParsed.data,
          zone_color: payload.zone_color,
          rule_type: payload.rule_type,
          access_rules: payload.access_rules,
        } as any)
        .eq("id", payload.zoneId);
      setSaving(false);
      if (error) {
        toast.error("수정 실패: " + error.message);
        return;
      }
      toast.success("통제 조건이 업데이트되었습니다");
      setZoneModalOpen(false);
      setEditingZone(null);
      setPendingShape(null);
      void loadZones();
      return;
    }

    if (!payload.shape) {
      setSaving(false);
      toast.error("도형 정보가 없습니다. 다시 그려 주세요.");
      return;
    }

    // Guard: never persist CRS.Simple pixel coords as if they were WGS84.
    const gpsOk =
      payload.shape.kind === "circle"
        ? looksLikeWgs84(payload.shape.center)
        : looksLikeWgs84Ring(payload.shape.latlngs);
    if (!gpsOk) {
      setSaving(false);
      toast.error(GPS_COORDS_INVALID_MSG);
      return;
    }

    const base = {
      project_id: projectId,
      name: payload.name,
      zone_category: catParsed.data,
      zone_color: payload.zone_color,
      rule_type: payload.rule_type,
      access_rules: payload.access_rules,
      banned_worker_ids: [] as string[],
      banned_company_ids: [] as string[],
      banned_job_types: [] as string[],
      is_active: true,
      created_by: (await supabase.auth.getUser()).data.user?.id,
    };

    const row =
      payload.shape.kind === "circle"
        ? {
            ...base,
            geometry_type: "radius" as const,
            center_lat: payload.shape.center.lat,
            center_lng: payload.shape.center.lng,
            radius_m: payload.shape.radius_m,
            geo_polygon: null,
          }
        : {
            ...base,
            geometry_type: "polygon" as const,
            geo_polygon: payload.shape.latlngs,
            center_lat: null,
            center_lng: null,
            radius_m: null,
          };

    const { error } = await supabase.from("restricted_zones").insert(row as any);
    setSaving(false);
    if (error) {
      toast.error("저장 실패: " + error.message);
      return;
    }
    toast.success("위험 구역이 저장되었습니다");
    setZoneModalOpen(false);
    setPendingShape(null);
    setEditingZone(null);
    void loadZones();
  };

  const focusZone = (z: Zone) => {
    // Zones tab uses CRS canvas (mapRef unmounted) — fly there instead.
    if (panelTab === "zones" && activeMap?.image_url && draftCorners) {
      setFocusZoneId(z.id);
      const off = isZoneOffImage(z, draftCorners);
      if (off) {
        toast.message("도면 밖 구역 — 필요하면 고급 위성 정렬을 확인하세요", {
          description:
            "모바일 원터치 등록이 GPS 보정 없이 저장된 경우 도면과 어긋납니다. 보정 후 재등록하세요.",
          duration: 5000,
        });
      }
      return;
    }
    setPanelTab("mapping");
    setLayers((l) => ({ ...l, zones: true, satellite: true }));
    const map = mapRef.current;
    if (!map) return;
    if (z.geometry_type === "radius" && z.center_lat != null && z.center_lng != null && z.radius_m) {
      const c = L.latLng(z.center_lat, z.center_lng);
      map.fitBounds(c.toBounds(Number(z.radius_m) * 2.4), { padding: [40, 40], maxZoom: 19 });
      return;
    }
    if (z.geo_polygon && z.geo_polygon.length >= 3) {
      map.fitBounds(
        L.latLngBounds(z.geo_polygon.map((p) => [p.lat, p.lng] as [number, number])),
        { padding: [40, 40], maxZoom: 19 },
      );
    }
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

  const toggleZoneActive = async (id: string, next: boolean) => {
    setZones((prev) => prev.map((z) => (z.id === id ? { ...z, is_active: next } : z)));
    const { error } = await supabase
      .from("restricted_zones")
      .update({ is_active: next } as any)
      .eq("id", id);
    if (error) {
      toast.error("알람 상태 변경 실패: " + error.message);
      void loadZones();
      return;
    }
    toast.success(next ? "알람 활성화" : "알람 비활성화");
  };

  const nudgeStep = useMemo(() => {
    if (!draftCorners) return 0.00005;
    // ~ relative to overlay size
    const dLat = Math.abs(draftCorners.tl.lat - draftCorners.bl.lat) || 0.001;
    return Math.max(dLat * 0.02, 0.00002);
  }, [draftCorners]);

  const applyGpsFix = useCallback(
    (lat: number, lng: number, accuracy: number, fly: boolean, cal?: GpsCalibration | null) => {
      const aligned = applyGpsCalibration(lat, lng, cal ?? gpsCal);
      setMyGps({
        lat: aligned.lat,
        lng: aligned.lng,
        rawLat: lat,
        rawLng: lng,
        accuracy,
        calibrated: aligned.calibrated,
      });
      if (fly && mapRef.current) {
        mapRef.current.setView(
          [aligned.lat, aligned.lng],
          Math.max(mapRef.current.getZoom(), 18),
          { animate: true },
        );
      }
    },
    [gpsCal],
  );

  const locateOnce = useCallback(() => {
    if (!navigator.geolocation) {
      toast.error("이 브라우저에서는 GPS를 사용할 수 없습니다");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        applyGpsFix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy || 20, true);
        toast.success(
          `내 위치 ±${Math.round(pos.coords.accuracy || 0)}m${
            gpsCal ? " (GPS 보정 적용)" : ""
          } — 모서리 찍기 버튼을 사용하세요`,
        );
      },
      (err) => toast.error("위치 확인 실패: " + (err.message || "권한/GPS 확인")),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 5_000 },
    );
  }, [applyGpsFix, gpsCal]);

  const toggleWatchGps = useCallback(() => {
    if (watchingGps) {
      if (gpsWatchRef.current != null) {
        navigator.geolocation.clearWatch(gpsWatchRef.current);
        gpsWatchRef.current = null;
      }
      setWatchingGps(false);
      toast.message("내 위치 추적을 중지했습니다");
      return;
    }
    if (!navigator.geolocation) {
      toast.error("이 브라우저에서는 GPS를 사용할 수 없습니다");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        applyGpsFix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy || 20, false);
      },
      (err) => toast.error("위치 추적 실패: " + (err.message || "권한/GPS 확인")),
      { enableHighAccuracy: true, maximumAge: 3_000, timeout: 25_000 },
    );
    gpsWatchRef.current = id;
    setWatchingGps(true);
    locateOnce();
  }, [watchingGps, applyGpsFix, locateOnce]);

  useEffect(
    () => () => {
      if (gpsWatchRef.current != null) {
        navigator.geolocation.clearWatch(gpsWatchRef.current);
      }
    },
    [],
  );

  const snapCornerToGps = useCallback(
    (key: "tl" | "tr" | "bl") => {
      if (!myGps) {
        toast.error("먼저 ‘내 위치’를 확인하세요");
        locateOnce();
        return;
      }
      if (!draftCorners) {
        toast.error("오버레이 모서리가 없습니다");
        return;
      }
      if (myGps.accuracy > 40) {
        toast.message(`GPS 정확도 ±${Math.round(myGps.accuracy)}m — 가능하면 야외에서 다시 찍어 주세요`);
      }
      setDraftCorners({
        ...draftCorners,
        [key]: { lat: myGps.rawLat, lng: myGps.rawLng },
      });
      const label = key === "tl" ? "좌상(TL)" : key === "tr" ? "우상(TR)" : "좌하(BL)";
      toast.success(
        `${label}을 현재 GPS(원시)로 찍었습니다${myGps.calibrated ? " · 표시 위치는 보정됨" : ""}`,
      );
    },
    [myGps, draftCorners, locateOnce],
  );

  const center: [number, number] = draftCorners
    ? (() => {
        const c = cornersCenter(draftCorners);
        return [c.lat, c.lng] as [number, number];
      })()
    : [37.5665, 126.978];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Map className="h-6 w-6 text-primary" />
            통합 현장 관제맵
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            현장 도면을 업로드한 뒤 모바일 워킹 보정으로 좌표를 맞춥니다. 위성 TL/TR/BL 정렬은
            선택(고급)입니다.
          </p>
          {gpsCal && (
            <div className="mt-2">
              <Badge variant="secondary" className="text-[11px]">
                GPS 보정 연동 중 ≈
                {Math.round(offsetMagnitudeM(gpsCal.d_lat, gpsCal.d_lng, gpsCal.map_lat || 37))}
                m ·{" "}
                {gpsCal.calibrated_at
                  ? new Date(gpsCal.calibrated_at).toLocaleString("ko-KR")
                  : ""}
              </Badge>
            </div>
          )}
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

      <div
        className={
          panelTab === "zones"
            ? "grid lg:grid-cols-[280px_1fr_300px] gap-4"
            : "grid lg:grid-cols-[340px_1fr] gap-4"
        }
      >
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">현장 관제 도구</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Tabs
              value={panelTab}
              onValueChange={(v) => setPanelTab(v as PanelTab)}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-2 h-auto">
                <TabsTrigger value="mapping" className="text-[11px] px-1 py-2 whitespace-normal leading-tight">
                  [1] 도면 업로드
                </TabsTrigger>
                <TabsTrigger value="zones" className="text-[11px] px-1 py-2 whitespace-normal leading-tight">
                  [2] 위험구역 설정
                </TabsTrigger>
              </TabsList>

              <TabsContent value="mapping" className="mt-3 space-y-3 focus-visible:outline-none">
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
                  현장 도면 업로드
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

                {activeMap?.image_url && (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 space-y-1.5">
                    <p className="text-[11px] font-medium text-emerald-900 dark:text-emerald-100">
                      권장 다음 단계 · 모바일 워킹 보정
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      마스터 앱 → <b>더보기</b> → <b>맵·GPS 맞추기</b> → 워킹 보정(A·B·C).
                      PC에서 위성에 사진을 입힐 필요는 없습니다.
                    </p>
                  </div>
                )}

                {draftCorners && activeMap?.image_url ? (
                  <Accordion type="single" collapsible className="rounded-md border bg-muted/40 px-2.5">
                    <AccordionItem value="advanced-sat" className="border-0">
                      <AccordionTrigger className="py-2.5 text-xs hover:no-underline">
                        고급 · PC 위성 TL/TR/BL 수동 정렬
                      </AccordionTrigger>
                      <AccordionContent className="space-y-3 pb-3">
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      선택 기능입니다. 모바일 워킹 보정 대신 PC에서 <b>TL·TR·BL</b> 마커를
                      드래그하거나 <b>현재 위치로 찍기</b>할 때 사용합니다.
                    </p>

                    <div className="space-y-1.5 rounded-md border bg-background/80 p-2">
                      <Label className="text-xs flex items-center gap-1">
                        <Crosshair className="h-3 w-3" /> 내 위치로 정렬
                      </Label>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="flex-1 h-8"
                          onClick={locateOnce}
                        >
                          <MapPin className="h-3.5 w-3.5 mr-1" /> 내 위치
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={watchingGps ? "default" : "outline"}
                          className="flex-1 h-8"
                          onClick={toggleWatchGps}
                        >
                          <Crosshair className="h-3.5 w-3.5 mr-1" />
                          {watchingGps ? "추적 중" : "추적"}
                        </Button>
                      </div>
                      {myGps && (
                        <p className="text-[10px] text-muted-foreground">
                          GPS {myGps.lat.toFixed(6)}, {myGps.lng.toFixed(6)} · ±
                          {Math.round(myGps.accuracy)}m
                        </p>
                      )}
                      <div className="grid grid-cols-3 gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-9 text-[11px] px-1"
                          onClick={() => snapCornerToGps("tl")}
                        >
                          TL 찍기
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-9 text-[11px] px-1"
                          onClick={() => snapCornerToGps("tr")}
                        >
                          TR 찍기
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-9 text-[11px] px-1"
                          onClick={() => snapCornerToGps("bl")}
                        >
                          BL 찍기
                        </Button>
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        도면의 좌상→우상→좌하 모서리에 순서대로 서서 찍으면 회전·스케일이
                        맞춰집니다. 모서리에 못 가면 모바일 워킹 보정을 권장합니다.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs flex items-center gap-1">
                          <RotateCw className="h-3 w-3" /> 회전
                        </Label>
                        <span className="text-[10px] text-muted-foreground">±{rotateStep}°</span>
                      </div>
                      <div className="flex gap-1">
                        <Button type="button" size="sm" variant="outline" className="flex-1 h-8"
                          onClick={() => setDraftCorners(rotateCorners(draftCorners, -rotateStep))}>
                          <RotateCcw className="h-3.5 w-3.5 mr-1" /> 반시계
                        </Button>
                        <Button type="button" size="sm" variant="outline" className="flex-1 h-8"
                          onClick={() => setDraftCorners(rotateCorners(draftCorners, rotateStep))}>
                          <RotateCw className="h-3.5 w-3.5 mr-1" /> 시계
                        </Button>
                      </div>
                      <Slider value={[rotateStep]} min={0.25} max={15} step={0.25}
                        onValueChange={(v) => setRotateStep(v[0] ?? 1)} />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs flex items-center gap-1">
                        <Move className="h-3 w-3" /> 미세 이동
                      </Label>
                      <div className="grid grid-cols-3 gap-1 w-28 mx-auto">
                        <span />
                        <Button type="button" size="icon" variant="outline" className="h-8 w-8"
                          onClick={() => setDraftCorners(translateCorners(draftCorners, nudgeStep, 0))}>
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <span />
                        <Button type="button" size="icon" variant="outline" className="h-8 w-8"
                          onClick={() => setDraftCorners(translateCorners(draftCorners, 0, -nudgeStep))}>
                          <ArrowLeft className="h-3.5 w-3.5" />
                        </Button>
                        <Button type="button" size="icon" variant="outline" className="h-8 w-8"
                          onClick={() => setDraftCorners(translateCorners(draftCorners, -nudgeStep, 0))}>
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button type="button" size="icon" variant="outline" className="h-8 w-8"
                          onClick={() => setDraftCorners(translateCorners(draftCorners, 0, nudgeStep))}>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex gap-1">
                      <Button type="button" size="sm" variant="outline" className="flex-1 h-8"
                        onClick={() => setDraftCorners(scaleCorners(draftCorners, 0.97))}>
                        <ZoomOut className="h-3.5 w-3.5 mr-1" /> 축소
                      </Button>
                      <Button type="button" size="sm" variant="outline" className="flex-1 h-8"
                        onClick={() => setDraftCorners(scaleCorners(draftCorners, 1.03))}>
                        <ZoomIn className="h-3.5 w-3.5 mr-1" /> 확대
                      </Button>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">투명도 {Math.round(opacity * 100)}%</Label>
                      <Slider value={[opacity]} min={0.2} max={1} step={0.05}
                        onValueChange={(v) => setOpacity(v[0] ?? 0.85)} />
                    </div>

                    <Button className="w-full" size="sm" onClick={() => void saveBounds()} disabled={savingBounds}>
                      {savingBounds ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                      위성 정렬 저장 (고급)
                    </Button>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                ) : (
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    도면을 업로드하면 모바일 워킹 보정으로 좌표를 맞출 수 있습니다. PC 위성
                    수동 정렬(고급)은 업로드 후 이 탭에서 펼칠 수 있습니다.
                  </p>
                )}
              </TabsContent>

              <TabsContent value="zones" className="mt-3 space-y-3 focus-visible:outline-none">
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  아래 버튼으로 평면 도면에 구역을 그립니다. 완료 후 허용/차단 목록 통제를 설정하면
                  GPS 좌표로 자동 변환·저장됩니다.
                </p>
                {!activeMap?.image_url && (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
                    먼저 [1] 도면 업로드 탭에서 현장 도면을 올리세요.
                  </div>
                )}
                {activeMap?.image_url && !draftCorners && (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
                    구역을 그리려면 지오레프가 필요합니다. 모바일 워킹 보정(권장) 또는 PC 위성
                    TL/TR/BL(고급)을 저장하세요.
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs">구역 색상</Label>
                  <div className="flex gap-1.5">
                    {ZONE_COLOR_OPTIONS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setDrawColor(c.value)}
                        className={`h-9 flex-1 rounded-md border text-[11px] font-semibold transition ${
                          drawColor === c.value ? "ring-2 ring-offset-1 ring-primary" : ""
                        }`}
                        style={{ backgroundColor: `${c.value}22`, borderColor: c.value, color: c.value }}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">그리기 도구</Label>
                  <div className="grid gap-2">
                    <Button
                      type="button"
                      variant={drawTool === "rectangle" ? "default" : "outline"}
                      className="h-11 justify-start"
                      disabled={!activeMap?.image_url || !draftCorners}
                      onClick={() => setDrawTool((t) => (t === "rectangle" ? null : "rectangle"))}
                    >
                      <Square className="h-4 w-4 mr-2" /> 사각형 그리기
                    </Button>
                    <Button
                      type="button"
                      variant={drawTool === "polygon" ? "default" : "outline"}
                      className="h-11 justify-start"
                      disabled={!activeMap?.image_url || !draftCorners}
                      onClick={() => setDrawTool((t) => (t === "polygon" ? null : "polygon"))}
                    >
                      <Pentagon className="h-4 w-4 mr-2" /> 다각형 그리기
                    </Button>
                    <Button
                      type="button"
                      variant={drawTool === "circle" ? "default" : "outline"}
                      className="h-11 justify-start"
                      disabled={!activeMap?.image_url || !draftCorners}
                      onClick={() => setDrawTool((t) => (t === "circle" ? null : "circle"))}
                    >
                      <CircleIcon className="h-4 w-4 mr-2" /> 원형 그리기
                    </Button>
                  </div>
                  {drawTool && (
                    <p className="text-[10px] text-primary space-y-0.5">
                      <span className="block">
                        {drawTool === "rectangle"
                          ? "사각형"
                          : drawTool === "polygon"
                            ? "다각형"
                            : "원형"}{" "}
                        모드 — 지도 이동(Panning)이 일시 차단됩니다. (Esc로 취소)
                      </span>
                      {drawTool === "polygon" && (
                        <span className="block text-muted-foreground">
                          클릭 = 꼭짓점 추가 · 더블클릭 = 닫기(Finish) 완료
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {panelTab === "zones" && activeMap?.image_url && draftCorners ? (
              <OrthogonalZoneCanvas
                className="h-[70vh] min-h-[420px] w-full"
                imageUrl={activeMap.image_url}
                corners={draftCorners}
                zones={zones}
                pendingGeoShape={pendingShape}
                pendingColor={drawColor}
                activeTool={drawTool}
                drawColor={drawColor}
                onToolFinished={() => setDrawTool(null)}
                onGeoShapeCreated={onShapeCreated}
                focusZoneId={focusZoneId}
                onFocusZone={(id) => setFocusZoneId(id)}
              />
            ) : (
            <div className="h-[70vh] min-h-[420px] w-full relative z-0">
              {panelTab === "zones" && (
                <div className="absolute inset-0 z-[900] flex items-center justify-center bg-muted/80 p-6 text-center text-sm text-muted-foreground">
                  {activeMap?.image_url
                    ? "지오레프가 필요합니다. 모바일 워킹 보정(권장) 또는 PC 위성 TL/TR/BL(고급)을 저장하세요."
                    : "현장 도면을 먼저 업로드하세요."}
                </div>
              )}
              <div className="absolute top-3 right-3 z-[1000] w-52 rounded-lg border bg-background/95 shadow-md p-3 space-y-2.5 backdrop-blur-sm">
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <Layers className="h-3.5 w-3.5" /> 레이어
                </div>
                <label className="flex items-center justify-between gap-2 text-xs cursor-pointer">
                  <span className="flex items-center gap-1.5">
                    <Satellite className="h-3.5 w-3.5 text-muted-foreground" /> VWorld 위성
                  </span>
                  <Switch
                    checked={layers.satellite}
                    onCheckedChange={(v) => setLayers((l) => ({ ...l, satellite: v }))}
                    disabled={panelTab === "zones"}
                  />
                </label>
                <p className="text-[10px] text-muted-foreground leading-snug -mt-1">
                  ON: 국토부 항공+라벨 · OFF: VWorld 도로
                </p>
                <label className="flex items-center justify-between gap-2 text-xs cursor-pointer">
                  <span className="flex items-center gap-1.5">
                    <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" /> 현장 도면
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

              <MapContainer center={center} zoom={17} maxZoom={19} className="h-full w-full" scrollWheelZoom>
                <VWorldBasemap satellite={layers.satellite} />

                <MapBridge onMap={onMapReady} seedRequest={seedRequest} onSeedCorners={onSeedCorners} />

                {layers.drone && activeMap?.image_url && draftCorners && (
                  <RotatedImageOverlay
                    url={activeMap.image_url}
                    corners={draftCorners}
                    opacity={opacity}
                  />
                )}

                {layers.drone && draftCorners && activeMap?.image_url && panelTab === "mapping" && (
                  <VisualCornerMarkers
                    corners={draftCorners}
                    onChange={setDraftCorners}
                    visible
                  />
                )}

                {myGps && (
                  <>
                    <Circle
                      center={[myGps.lat, myGps.lng]}
                      radius={Math.max(myGps.accuracy, 5)}
                      pathOptions={{
                        color: "#2563eb",
                        weight: 1,
                        fillColor: "#3b82f6",
                        fillOpacity: 0.12,
                      }}
                    />
                    <Marker position={[myGps.lat, myGps.lng]} icon={MY_LOC_ICON} />
                  </>
                )}

                <FitToTargets
                  imageBounds={layers.drone ? leafletBounds : null}
                  zones={layers.zones ? zones.filter((z) => z.is_active !== false) : []}
                  enabled
                  token={fitToken}
                />

                {layers.zones && pendingShape?.kind === "polygon" && (
                  <Polygon
                    positions={pendingShape.latlngs.map((p) => [p.lat, p.lng] as [number, number])}
                    pathOptions={{ color: "#f59e0b", weight: 2, dashArray: "6 4" }}
                  />
                )}
                {layers.zones && pendingShape?.kind === "circle" && (
                  <Circle
                    center={[pendingShape.center.lat, pendingShape.center.lng]}
                    radius={pendingShape.radius_m}
                    pathOptions={{ color: "#f59e0b", weight: 2, dashArray: "6 4", fillOpacity: 0.15 }}
                  />
                )}

                {layers.zones &&
                  zones
                    .filter((z) => z.is_active !== false)
                    .map((z) =>
                    z.geometry_type === "radius" &&
                    z.center_lat != null &&
                    z.center_lng != null &&
                    z.radius_m ? (
                      <Circle
                        key={z.id}
                        center={[z.center_lat, z.center_lng]}
                        radius={Number(z.radius_m)}
                        pathOptions={{ color: "#ef4444", fillOpacity: 0.2 }}
                        eventHandlers={{ click: () => focusZone(z) }}
                      />
                    ) : z.geo_polygon && z.geo_polygon.length >= 3 ? (
                      <Polygon
                        key={z.id}
                        positions={z.geo_polygon.map((p) => [p.lat, p.lng] as [number, number])}
                        pathOptions={{ color: "#ef4444", fillOpacity: 0.2 }}
                        eventHandlers={{ click: () => focusZone(z) }}
                      />
                    ) : null,
                  )}
              </MapContainer>

              {activeMap?.image_url && !draftCorners && panelTab === "mapping" && (
                <div className="absolute inset-x-0 bottom-3 mx-auto max-w-md rounded-lg bg-background/95 border p-3 text-xs text-center shadow z-[500]">
                  고급 정렬용 마커 준비 중…
                </div>
              )}
            </div>
            )}
          </CardContent>
        </Card>

        {panelTab === "zones" && (
          <Card className="overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-1.5">
                <ShieldAlert className="h-4 w-4 text-destructive" />
                등록 구역 {zones.length}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2 max-h-[70vh] overflow-auto">
              {zones.length === 0 && (
                <div className="text-muted-foreground text-center py-8 text-xs border rounded-md">
                  등록된 위험구역이 없습니다.
                </div>
              )}
              {zones.map((z) => {
                const rules = parseAccessRules(z.access_rules);
                const rt =
                  z.rule_type === "ALLOW" || z.rule_type === "DENY" ? z.rule_type : rules.rule_type;
                const companyNames = (rules.company_ids || [])
                  .map((id) => companies.find((c) => c.id === id)?.name || id.slice(0, 6))
                  .slice(0, 6);
                const jobs = (rules.job_types || []).slice(0, 6);
                return (
                  <div
                    key={z.id}
                    className="rounded-md border p-2.5 space-y-2 hover:bg-muted/40 transition-colors"
                    style={{ borderLeftWidth: 4, borderLeftColor: z.zone_color || "#ef4444" }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        className="min-w-0 text-left flex-1"
                        onClick={() => focusZone(z)}
                      >
                        <div className="font-medium truncate text-sm text-foreground">{z.name}</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {z.zone_category && (
                            <Badge variant="outline" className="text-[10px]">{z.zone_category}</Badge>
                          )}
                          {draftCorners && isZoneOffImage(z, draftCorners) && (
                            <Badge
                              variant="outline"
                              className="text-[10px] border-amber-500 text-amber-700"
                            >
                              도면 밖
                            </Badge>
                          )}
                          <Badge variant="secondary" className="text-[10px]">
                            {z.geometry_type === "radius" ? `원 ${z.radius_m}m` : "폴리곤"}
                          </Badge>
                          <Badge
                            className={`text-[10px] ${
                              rt === "ALLOW"
                                ? "bg-emerald-600 hover:bg-emerald-600"
                                : "bg-destructive hover:bg-destructive"
                            }`}
                          >
                            {ruleTypeLabel(rt)}
                          </Badge>
                        </div>
                      </button>
                      <div className="flex shrink-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="통제 조건 수정"
                          onClick={() => openEditZone(z)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => void deleteZone(z.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {companyNames.map((n) => (
                        <Badge key={`c-${z.id}-${n}`} variant="outline" className="text-[10px] font-normal">
                          {rt === "ALLOW" ? "허용" : "차단"} · {n}
                        </Badge>
                      ))}
                      {jobs.map((j) => (
                        <Badge key={`j-${z.id}-${j}`} variant="outline" className="text-[10px] font-normal">
                          {rt === "ALLOW" ? "허용" : "차단"} · {j}
                        </Badge>
                      ))}
                      {companyNames.length + jobs.length === 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          {accessRulesSummary(z.access_rules, z.rule_type)}
                        </span>
                      )}
                    </div>

                    <label className="flex items-center justify-between gap-2 text-xs cursor-pointer border-t pt-2">
                      <span className="font-medium">알람 활성화</span>
                      <Switch
                        checked={z.is_active !== false}
                        onCheckedChange={(v) => void toggleZoneActive(z.id, v)}
                      />
                    </label>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>

      <ZoneAccessRulesDialog
        open={zoneModalOpen}
        shape={pendingShape}
        editZone={editingZone}
        companies={companies}
        defaultColor={drawColor}
        saving={saving}
        onOpenChange={(open) => {
          setZoneModalOpen(open);
          if (!open) {
            setPendingShape(null);
            setEditingZone(null);
          }
        }}
        onSave={saveZoneFromModal}
      />
    </div>
  );
}
