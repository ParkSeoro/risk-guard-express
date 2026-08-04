/**
 * Master-only: tap map standing point → capture GPS → save project GPS bias.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNavigateMobileHome } from "@/lib/mobileNav";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Crosshair, Loader2, MapPin, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { loadCornersFromMap } from "@/lib/mapBounds";
import { uvToLatLng } from "@/lib/tracking/imageSpaceGeo";
import {
  clearGpsCalibrationCache,
  computeGpsOffset,
  GPS_CAL_MAX_ACCURACY_M,
  GPS_CAL_MAX_OFFSET_M,
  offsetMagnitudeM,
  parseGpsCalibration,
  type GpsCalibration,
} from "@/lib/tracking/gpsCalibration";

type SiteMapRow = {
  id: string;
  name: string;
  image_url: string | null;
  geo_anchor_nw_lat: number | null;
  geo_anchor_nw_lng: number | null;
  geo_anchor_se_lat: number | null;
  geo_anchor_se_lng: number | null;
  geo_transform?: unknown;
};

async function getCurrentPosition(): Promise<{ lat: number; lng: number; accuracy: number }> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      await Geolocation.requestPermissions();
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 20000,
      });
      return {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? 20,
      };
    } catch {
      /* fall through */
    }
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("이 기기는 위치를 지원하지 않습니다"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy ?? 20,
        }),
      (e) => reject(new Error(e.message || "위치 수신 실패")),
      { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 },
    );
  });
}

export default function MobileMapCalibration() {
  const navigate = useNavigate();
  const goHome = useNavigateMobileHome();
  const { hasRole, user } = useAuth();
  const { projectId } = useMobileAccess();
  const isMaster = hasRole("master");

  const [maps, setMaps] = useState<SiteMapRow[]>([]);
  const [mapId, setMapId] = useState("");
  const [existing, setExisting] = useState<GpsCalibration | null>(null);
  const [tapUv, setTapUv] = useState<{ u: number; v: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const active = maps.find((m) => m.id === mapId) || null;
  const corners = active ? loadCornersFromMap(active) : null;

  const reload = useCallback(async () => {
    if (!projectId) return;
    const [{ data: mapRows }, { data: proj }] = await Promise.all([
      supabase
        .from("site_maps")
        .select(
          "id,name,image_url,geo_anchor_nw_lat,geo_anchor_nw_lng,geo_anchor_se_lat,geo_anchor_se_lng,geo_transform",
        )
        .eq("project_id", projectId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false }),
      supabase.from("projects").select("gps_calibration").eq("id", projectId).maybeSingle(),
    ]);
    const list = (mapRows || []) as SiteMapRow[];
    setMaps(list);
    setMapId((prev) => prev || list[0]?.id || "");
    setExisting(parseGpsCalibration((proj as { gps_calibration?: unknown } | null)?.gps_calibration));
  }, [projectId]);

  useEffect(() => {
    if (!isMaster) return;
    void reload();
  }, [isMaster, reload]);

  if (!isMaster) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        마스터 전용 기능입니다.
        <Button className="mt-3" variant="outline" onClick={() => goHome()}>
          홈으로
        </Button>
      </div>
    );
  }

  const onImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const u = (e.clientX - rect.left) / Math.max(rect.width, 1);
    const v = (e.clientY - rect.top) / Math.max(rect.height, 1);
    setTapUv({
      u: Math.min(1, Math.max(0, u)),
      v: Math.min(1, Math.max(0, v)),
    });
  };

  const save = async () => {
    if (!projectId || !active || !corners || !tapUv) {
      toast.error("맵을 탭해 현재 선 자리를 지정하세요");
      return;
    }
    if (!active.image_url) {
      toast.error("드론 도면이 없는 맵입니다");
      return;
    }
    setBusy(true);
    try {
      const mapPt = uvToLatLng(tapUv, corners);
      const raw = await getCurrentPosition();
      if (raw.accuracy > GPS_CAL_MAX_ACCURACY_M) {
        toast.error(
          `GPS 정확도 ±${Math.round(raw.accuracy)}m — ${GPS_CAL_MAX_ACCURACY_M}m 이하일 때만 저장합니다 (야외에서 재시도)`,
        );
        return;
      }
      const { d_lat, d_lng } = computeGpsOffset(mapPt, raw);
      const mag = offsetMagnitudeM(d_lat, d_lng, mapPt.lat);
      if (mag > GPS_CAL_MAX_OFFSET_M) {
        toast.error(
          `보정량 ≈${Math.round(mag)}m 로 너무 큽니다. 도면 지점/맵핑(TL·TR·BL)을 확인하세요 (한도 ${GPS_CAL_MAX_OFFSET_M}m)`,
        );
        return;
      }
      const payload: GpsCalibration = {
        d_lat,
        d_lng,
        accuracy_m: raw.accuracy,
        site_map_id: active.id,
        map_lat: mapPt.lat,
        map_lng: mapPt.lng,
        raw_lat: raw.lat,
        raw_lng: raw.lng,
        calibrated_at: new Date().toISOString(),
        calibrated_by: user?.id ?? null,
      };
      const { error } = await supabase
        .from("projects")
        .update({ gps_calibration: payload as any })
        .eq("id", projectId);
      if (error) throw error;
      clearGpsCalibrationCache(projectId);
      setExisting(payload);
      toast.success(`보정 저장 · 약 ${Math.round(mag)}m 이동 (GPS ±${Math.round(raw.accuracy)}m)`);
    } catch (e: any) {
      toast.error(e?.message || "저장 실패");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!projectId) return;
    setBusy(true);
    const { error } = await supabase
      .from("projects")
      .update({ gps_calibration: null as any })
      .eq("id", projectId);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    clearGpsCalibrationCache(projectId);
    setExisting(null);
    setTapUv(null);
    toast.message("GPS 보정을 초기화했습니다");
  };

  const previewMag =
    existing != null
      ? offsetMagnitudeM(existing.d_lat, existing.d_lng, existing.map_lat || 37)
      : null;

  return (
    <div className="min-h-screen bg-muted/30 pb-28">
      <header className="bg-primary text-primary-foreground p-4 flex items-center gap-3 sticky top-0 z-10">
        <Button
          size="icon"
          variant="ghost"
          className="text-primary-foreground hover:bg-primary/80"
          onClick={() => goHome()}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="font-bold text-base">맵·GPS 맞추기</h1>
          <p className="text-[11px] opacity-90">마스터 · 1점 보정</p>
        </div>
        <Badge variant="secondary" className="text-[10px]">
          Phase A
        </Badge>
      </header>

      <main className="p-4 space-y-3 max-w-lg mx-auto">
        <Card>
          <CardContent className="p-3 text-[11px] text-muted-foreground leading-relaxed space-y-1">
            <p>
              PC에서 드론 맵핑(TL·TR·BL)을 맞춰 둔 뒤, 현장에서 <b>지금 선 자리</b>를 도면에서
              탭하고 GPS로 맞춥니다. 전 근로자 지오펜스에 같은 보정량이 적용됩니다.
            </p>
            <p>
              GPS 정확도 ≤{GPS_CAL_MAX_ACCURACY_M}m, 보정량 ≤{GPS_CAL_MAX_OFFSET_M}m 일 때만
              저장됩니다.
            </p>
          </CardContent>
        </Card>

        {!projectId && (
          <p className="text-sm text-destructive">프로젝트를 먼저 선택하세요 (홈 화면).</p>
        )}

        {maps.length > 0 && (
          <select
            className="w-full h-10 rounded-md border bg-background px-2 text-sm"
            value={mapId}
            onChange={(e) => {
              setMapId(e.target.value);
              setTapUv(null);
            }}
          >
            {maps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}

        {active?.image_url && corners ? (
          <div className="relative rounded-lg border overflow-hidden bg-black">
            <img
              ref={imgRef}
              src={active.image_url}
              alt={active.name}
              className="w-full h-auto block touch-manipulation"
              onClick={onImageClick}
            />
            {tapUv && (
              <div
                className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 border-white bg-blue-500 shadow pointer-events-none"
                style={{ left: `${tapUv.u * 100}%`, top: `${tapUv.v * 100}%` }}
              />
            )}
          </div>
        ) : (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              {maps.length === 0
                ? "등록된 사이트맵이 없습니다. PC 현장통제맵에서 드론 맵핑을 먼저 하세요."
                : "이 맵에 TL/TR/BL(또는 NW/SE) 좌표가 없습니다. 맵핑 탭에서 정렬을 저장하세요."}
            </CardContent>
          </Card>
        )}

        {tapUv && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" /> 도면 지점 선택됨 — 그 자리에 서서 아래 버튼을
            누르세요
          </p>
        )}

        {existing && (
          <Card>
            <CardContent className="p-3 text-xs space-y-1">
              <div className="font-medium">적용 중 보정</div>
              <div className="text-muted-foreground">
                ≈{previewMag != null ? Math.round(previewMag) : "?"}m · GPS ±
                {Math.round(existing.accuracy_m)}m ·{" "}
                {existing.calibrated_at
                  ? new Date(existing.calibrated_at).toLocaleString("ko-KR")
                  : "-"}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-2">
          <Button
            className="h-12"
            disabled={busy || !tapUv || !corners || !projectId}
            onClick={() => void save()}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Crosshair className="h-4 w-4 mr-2" />
            )}
            현재 GPS로 맞추기 · 저장
          </Button>
          <Button
            variant="outline"
            className="h-11"
            disabled={busy || !existing || !projectId}
            onClick={() => void clear()}
          >
            <Trash2 className="h-4 w-4 mr-2" /> 보정 초기화
          </Button>
        </div>
      </main>
    </div>
  );
}
