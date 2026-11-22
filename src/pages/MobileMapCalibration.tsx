/**
 * Mobile Map ↔ GPS Walking Calibration (v2):
 * - Accessible to `master` + non-contractor `project_admin` + `safety_manager`
 *   (enforced in UI via `canCalibrateSiteMap` and in DB via `save_site_map_georef` / `save_project_gps_calibration`).
 * - Walk mode: tap your real standing landmark on the drone photo → collect 3.5s multi-sample
 *   weighted-average GPS fix → fit 4-DOF Similarity Transform (preserves aspect ratio & 90° corners,
 *   produces REAL residual RMS error even at 3 points) → immediately verify with live blue GPS dot!
 * - Bias mode: optional 1-point residual offset cleanup after walking georef.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMobileSubpageBack, useNavigateMobileHome } from "@/lib/mobileNav";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  CheckCircle2,
  Crosshair,
  Footprints,
  Loader2,
  MapPin,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cornersToPersistPayload, loadCornersFromMap, parseSiteMapView } from "@/lib/mapBounds";
import { latLngToUv, uvToLatLng } from "@/lib/tracking/imageSpaceGeo";
import ZoomableSiteMapImage, {
  type MapMarker,
} from "@/components/geofence/ZoomableSiteMapImage";
import {
  computeGpsOffset,
  GPS_CAL_MAX_ACCURACY_M,
  GPS_CAL_MAX_OFFSET_M,
  offsetMagnitudeM,
  parseGpsCalibration,
  type GpsCalibration,
} from "@/lib/tracking/gpsCalibration";
import { notifyGpsCalibrationChanged } from "@/lib/tracking/gpsCalibrationRealtime";
import { canCalibrateSiteMap } from "@/lib/tracking/mapCalibrationAccess";
import {
  aggregateGpsSamples,
  fitSimilarityFromControlPoints,
  type GpsSample,
  type WalkControlPoint,
} from "@/lib/tracking/fitAffineFromControlPoints";

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

type Mode = "walk" | "bias";

type CapturedPoint = {
  id: string;
  label: string;
  u: number;
  v: number;
  lat: number;
  lng: number;
  accuracy_m: number;
  sampleCount: number;
  spreadM: number;
};

const SAMPLE_WINDOW_MS = 3500;
const SAMPLE_TARGET_COUNT = 6;

async function getCurrentPosition(): Promise<GpsSample> {
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

async function watchPosition(
  onFix: (fix: GpsSample) => void,
  onError?: (msg: string) => void,
): Promise<() => void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      await Geolocation.requestPermissions();
      const id = await Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: 20000 },
        (pos, err) => {
          if (err || !pos) {
            onError?.(err?.message || "위치 수신 실패");
            return;
          }
          onFix({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? 20,
          });
        },
      );
      return () => {
        void Geolocation.clearWatch({ id });
      };
    } catch {
      /* fall through */
    }
  }
  if (!navigator.geolocation) {
    onError?.("이 기기는 위치를 지원하지 않습니다");
    return () => undefined;
  }
  const id = navigator.geolocation.watchPosition(
    (p) =>
      onFix({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracy: p.coords.accuracy ?? 20,
      }),
    (e) => onError?.(e.message || "위치 수신 실패"),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 25000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

export default function MobileMapCalibration() {
  const goHome = useNavigateMobileHome();
  const onBack = useMobileSubpageBack("/app/worker/more");
  const { hasRole, user } = useAuth();
  const { projectId, role, companyType, isMaster: mobileMaster, loading: accessLoading } =
    useMobileAccess();
  const isMaster = hasRole("master") || mobileMaster;
  const canCalibrate = canCalibrateSiteMap({ isMaster, role, companyType });

  const [mode, setMode] = useState<Mode>("walk");
  const [maps, setMaps] = useState<SiteMapRow[]>([]);
  const [mapId, setMapId] = useState("");
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null);
  const [existing, setExisting] = useState<GpsCalibration | null>(null);

  /** Tapped standing spot on the drone photo (both walk & bias modes). */
  const [tapUv, setTapUv] = useState<{ u: number; v: number } | null>(null);
  /** Captured walking control points (each individually removable). */
  const [points, setPoints] = useState<CapturedPoint[]>([]);
  const [savedNotice, setSavedNotice] = useState<{ rmsM: number; widthM: number; heightM: number } | null>(
    null,
  );

  /** Always-on live GPS watch for warm-up, multi-sample capture, and instant post-save verification. */
  const [liveGps, setLiveGps] = useState<GpsSample | null>(null);
  const [liveWatching, setLiveWatching] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureProgress, setCaptureProgress] = useState<{ count: number; target: number } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const stopWatchRef = useRef<(() => void) | null>(null);
  const liveGpsRef = useRef<GpsSample | null>(null);
  const sampleCollectorRef = useRef<((fix: GpsSample) => void) | null>(null);
  const pointSeqRef = useRef(1);

  const active = maps.find((m) => m.id === mapId) || null;
  const corners = active ? loadCornersFromMap(active as any) : null;
  const imageAspectRatio = imageSize && imageSize.h > 0 ? imageSize.w / imageSize.h : 4 / 3;

  const reload = useCallback(
    async (explicitMapId?: string) => {
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
      const chosenId =
        explicitMapId && list.some((m) => m.id === explicitMapId)
          ? explicitMapId
          : list.some((m) => m.id === mapId)
            ? mapId
            : list[0]?.id || "";
      if (chosenId !== mapId) setMapId(chosenId);
      setExisting(
        parseGpsCalibration((proj as { gps_calibration?: unknown } | null)?.gps_calibration),
      );
    },
    [projectId, mapId],
  );

  useEffect(() => {
    if (!canCalibrate || !projectId) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCalibrate, projectId]);

  // Always-on live GPS watch while on this screen (warms up GNSS + powers instant verification dot)
  useEffect(() => {
    if (!canCalibrate) return;
    let cancelled = false;
    setLiveWatching(true);
    void watchPosition(
      (fix) => {
        if (cancelled) return;
        liveGpsRef.current = fix;
        setLiveGps(fix);
        sampleCollectorRef.current?.(fix);
      },
      (msg) => {
        if (!cancelled) toast.error(msg);
      },
    ).then((stop) => {
      if (cancelled) {
        stop();
        return;
      }
      stopWatchRef.current = stop;
    });
    return () => {
      cancelled = true;
      stopWatchRef.current?.();
      stopWatchRef.current = null;
      setLiveWatching(false);
    };
  }, [canCalibrate]);

  /** Collect multi-sample GPS fixes over ~3.5 seconds while standing still. */
  const collectAveragedFix = useCallback(async (): Promise<GpsSample & { sampleCount: number; spreadM: number }> => {
    const collected: GpsSample[] = [];
    if (liveGpsRef.current) {
      collected.push(liveGpsRef.current);
    }
    setCaptureProgress({ count: collected.length, target: SAMPLE_TARGET_COUNT });

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        sampleCollectorRef.current = null;
        window.clearTimeout(timer);
        resolve();
      };
      sampleCollectorRef.current = (fix) => {
        collected.push(fix);
        setCaptureProgress({ count: collected.length, target: SAMPLE_TARGET_COUNT });
        if (collected.length >= SAMPLE_TARGET_COUNT) {
          finish();
        }
      };
      const timer = window.setTimeout(finish, SAMPLE_WINDOW_MS);
    });

    if (collected.length === 0) {
      const fresh = await getCurrentPosition();
      collected.push(fresh);
    }

    const agg = aggregateGpsSamples(collected, GPS_CAL_MAX_ACCURACY_M);
    if ("error" in agg) {
      throw new Error(agg.error);
    }
    return {
      lat: agg.lat,
      lng: agg.lng,
      accuracy: agg.accuracy_m,
      sampleCount: agg.keptCount,
      spreadM: agg.spreadM,
    };
  }, []);

  /** Live 4-DOF Similarity Fit preview as soon as 3+ points are recorded. */
  const liveFit = useMemo(() => {
    if (points.length < 3) return null;
    const ctrl: WalkControlPoint[] = points.map((p) => ({
      id: p.id,
      u: p.u,
      v: p.v,
      lat: p.lat,
      lng: p.lng,
      accuracy_m: p.accuracy_m,
    }));
    return fitSimilarityFromControlPoints(ctrl, imageAspectRatio);
  }, [points, imageAspectRatio]);

  /** Project live GPS onto the map (prefers preview corners when 3+ points fit cleanly, else saved corners). */
  const previewCorners = liveFit && !("error" in liveFit) ? liveFit.corners : corners;
  const liveGpsUv = useMemo(() => {
    if (!liveGps || !previewCorners) return null;
    const uv = latLngToUv({ lat: liveGps.lat, lng: liveGps.lng }, previewCorners);
    if (!Number.isFinite(uv.u) || !Number.isFinite(uv.v)) return null;
    if (uv.u < -0.2 || uv.u > 1.2 || uv.v < -0.2 || uv.v > 1.2) return null;
    return uv;
  }, [liveGps, previewCorners]);

  const previewOffsetM = useMemo(() => {
    if (!tapUv || !liveGps || !corners) return null;
    const mapPt = uvToLatLng(tapUv, corners);
    const { d_lat, d_lng } = computeGpsOffset(mapPt, liveGps);
    return offsetMagnitudeM(d_lat, d_lng, mapPt.lat);
  }, [tapUv, liveGps, corners]);

  const walkMarkers: MapMarker[] = useMemo(() => {
    const list: MapMarker[] = points.map((p) => ({
      u: p.u,
      v: p.v,
      label: `✓${p.label}`,
      tone: "emerald",
    }));
    if (tapUv) {
      list.push({
        u: tapUv.u,
        v: tapUv.v,
        label: "선택 지점",
        tone: "amber",
      });
    }
    if (liveGpsUv) {
      list.push({
        u: liveGpsUv.u,
        v: liveGpsUv.v,
        label: liveGps ? `내 GPS ±${Math.round(liveGps.accuracy)}m` : "내 GPS",
        tone: "blue",
      });
    }
    return list;
  }, [points, tapUv, liveGpsUv, liveGps]);

  const biasMarkers: MapMarker[] = useMemo(() => {
    const list: MapMarker[] = [];
    if (liveGpsUv) {
      list.push({
        u: liveGpsUv.u,
        v: liveGpsUv.v,
        label: liveGps ? `GPS±${Math.round(liveGps.accuracy)}` : "GPS",
        tone: "rose",
      });
    }
    if (tapUv) {
      list.push({
        u: tapUv.u,
        v: tapUv.v,
        label: "참위치",
        tone: "blue",
      });
    }
    return list;
  }, [liveGpsUv, liveGps, tapUv]);

  if (!accessLoading && !canCalibrate) {
    return (
      <div className="p-6 text-sm text-muted-foreground space-y-3">
        <p>
          맵·GPS 보정은 마스터·프로젝트 관리자·안전관리자(발주처·시공사) 전용 기능입니다.
        </p>
        <Button variant="outline" onClick={() => goHome()}>
          홈으로
        </Button>
      </div>
    );
  }

  const captureCurrentPoint = async () => {
    if (!tapUv) {
      toast.error("먼저 도면에서 지금 서 있는 지점을 탭해 주세요");
      return;
    }
    setCapturing(true);
    try {
      const fix = await collectAveragedFix();
      const seq = pointSeqRef.current++;
      const nextPt: CapturedPoint = {
        id: `pt-${seq}`,
        label: String(seq),
        u: tapUv.u,
        v: tapUv.v,
        lat: fix.lat,
        lng: fix.lng,
        accuracy_m: fix.accuracy,
        sampleCount: fix.sampleCount,
        spreadM: fix.spreadM,
      };
      setPoints((prev) => [...prev, nextPt]);
      setTapUv(null);
      setSavedNotice(null);
      toast.success(
        `지점 #${seq} 측정 완료 · ${fix.sampleCount}샘플 평균 (±${Math.round(fix.accuracy)}m)`,
      );
    } catch (e: any) {
      toast.error(e?.message || "GPS 측정 실패");
    } finally {
      setCapturing(false);
      setCaptureProgress(null);
    }
  };

  const removePoint = (id: string) => {
    setPoints((prev) => prev.filter((p) => p.id !== id));
    setSavedNotice(null);
  };

  const applyWalkFit = async () => {
    if (!projectId || !active) return;
    if (!liveFit || "error" in liveFit) {
      toast.error(liveFit && "error" in liveFit ? liveFit.error : "최소 3개 지점을 측정해 주세요");
      return;
    }
    setBusy(true);
    try {
      const payload = cornersToPersistPayload(liveFit.corners, 0.85, {
        view: parseSiteMapView(active.geo_transform),
        source: "walk",
      });
      const { error } = await supabase.rpc("save_site_map_georef" as any, {
        _site_map_id: active.id,
        _geo_transform: payload.geo_transform,
        _nw_lat: payload.geo_anchor_nw_lat,
        _nw_lng: payload.geo_anchor_nw_lng,
        _se_lat: payload.geo_anchor_se_lat,
        _se_lng: payload.geo_anchor_se_lng,
        _clear_gps_calibration: true,
      });
      if (error) throw error;

      await notifyGpsCalibrationChanged(projectId);
      setExisting(null);
      await reload(active.id);
      setSavedNotice({
        rmsM: liveFit.rmsM,
        widthM: liveFit.widthM,
        heightM: liveFit.heightM,
      });
      toast.success(
        `현장맵 워킹 보정 저장 완료 · 잔차 RMS ≈${liveFit.rmsM.toFixed(1)}m`,
        {
          description:
            "도면 위 파란 '내 GPS' 점이 실제 서 있는 자리와 맞는지 걸어 다니며 바로 확인해 보세요.",
          duration: 7000,
        },
      );
    } catch (e: any) {
      toast.error(e?.message || "저장 실패");
    } finally {
      setBusy(false);
    }
  };

  const saveBias = async () => {
    if (!projectId || !active || !corners || !tapUv) {
      toast.error("맵에서 내가 서 있는 참위치를 탭하세요");
      return;
    }
    if (!active.image_url) {
      toast.error("드론 도면이 없는 맵입니다");
      return;
    }
    setBusy(true);
    try {
      const mapPt = uvToLatLng(tapUv, corners);
      const avg = await collectAveragedFix();
      const { d_lat, d_lng } = computeGpsOffset(mapPt, avg);
      const mag = offsetMagnitudeM(d_lat, d_lng, mapPt.lat);
      if (mag > GPS_CAL_MAX_OFFSET_M) {
        toast.error(`보정량 ≈${Math.round(mag)}m 로 너무 큽니다 (한도 ${GPS_CAL_MAX_OFFSET_M}m)`);
        return;
      }
      const payload: GpsCalibration = {
        d_lat,
        d_lng,
        accuracy_m: avg.accuracy,
        site_map_id: active.id,
        map_lat: mapPt.lat,
        map_lng: mapPt.lng,
        raw_lat: avg.lat,
        raw_lng: avg.lng,
        calibrated_at: new Date().toISOString(),
        calibrated_by: user?.id ?? null,
      };
      const { error } = await supabase.rpc("save_project_gps_calibration" as any, {
        _project_id: projectId,
        _calibration: payload,
      });
      if (error) throw error;
      await notifyGpsCalibrationChanged(projectId);
      setExisting(payload);
      toast.success(`1점 미세 보정 저장 · 약 ${Math.round(mag)}m (${avg.sampleCount}샘플 평균)`);
    } catch (e: any) {
      toast.error(e?.message || "저장 실패");
    } finally {
      setBusy(false);
    }
  };

  const clearBias = async () => {
    if (!projectId) return;
    setBusy(true);
    const { error } = await supabase.rpc("save_project_gps_calibration" as any, {
      _project_id: projectId,
      _calibration: null,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await notifyGpsCalibrationChanged(projectId);
    setExisting(null);
    setTapUv(null);
    toast.message("1점 보정을 초기화했습니다");
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
          onClick={onBack}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="font-bold text-base">맵·GPS 맞추기</h1>
          <p className="text-[11px] opacity-90">현장 워킹 정밀 보정 (4자유도 유사변환 · 다중 평균)</p>
        </div>
        <Badge variant="secondary" className="text-[10px]">
          {liveGps ? `GPS ±${Math.round(liveGps.accuracy)}m` : liveWatching ? "GPS 수신중…" : "대기"}
        </Badge>
      </header>

      <main className="p-4 space-y-3 max-w-lg mx-auto">
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={mode === "walk" ? "default" : "outline"}
            className="h-10"
            onClick={() => setMode("walk")}
          >
            <Footprints className="h-4 w-4 mr-1.5" /> 워킹 보정 (권장)
          </Button>
          <Button
            variant={mode === "bias" ? "default" : "outline"}
            className="h-10"
            onClick={() => setMode("bias")}
          >
            <Crosshair className="h-4 w-4 mr-1.5" /> 1점 미세 보정
          </Button>
        </div>

        <Card>
          <CardContent className="p-3 text-[11px] text-muted-foreground leading-relaxed space-y-1">
            {mode === "walk" ? (
              <>
                <p>
                  <b>사용법:</b> 현장의 뚜렷한 모서리 <b>3~4곳</b>(정문·건물 코너 등)을 직접 걸어가서 →
                  도면을 확대해 <b>내가 서 있는 위치 탭</b> → <b>[이 위치 GPS 측정]</b>을 누르세요.
                </p>
                <p>
                  3.5초간 여러 번 측정해 튄 값을 걸러내며, 도면 비율을 유지(찌그러짐 방지)하면서 실제 오차(RMS)를 계산합니다.
                </p>
              </>
            ) : (
              <>
                <p>
                  워킹 보정 후 전체가 몇 m씩 일정하게 어긋날 때만 사용합니다. 지금 서 있는{" "}
                  <b>참위치(파란)</b>를 탭하고 저장하세요.
                </p>
              </>
            )}
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
              const next = e.target.value;
              setMapId(next);
              setTapUv(null);
              setPoints([]);
              setSavedNotice(null);
              setImageSize(null);
              void reload(next);
            }}
          >
            {maps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}

        {active?.image_url && (mode === "bias" ? corners : true) ? (
          <ZoomableSiteMapImage
            src={active.image_url}
            alt={active.name}
            marker={null}
            markers={mode === "walk" ? walkMarkers : biasMarkers}
            onImageSize={setImageSize}
            onPick={(uv) => setTapUv(uv)}
          />
        ) : (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              {maps.length === 0
                ? "등록된 현장 도면이 없습니다. PC 「통합 현장 관제맵」에서 도면을 먼저 업로드하세요."
                : mode === "bias"
                  ? "이 맵에 지오레프가 없습니다. 먼저 워킹 보정으로 3곳 이상을 측정해 주세요."
                  : "맵 이미지를 불러올 수 없습니다."}
            </CardContent>
          </Card>
        )}

        {mode === "walk" && (
          <>
            <div className="grid gap-2">
              <Button
                className="h-12"
                disabled={capturing || busy || !tapUv || !projectId || !active?.image_url}
                onClick={() => void captureCurrentPoint()}
              >
                {capturing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    평균 측정 중… ({captureProgress?.count ?? 0}/{captureProgress?.target ?? SAMPLE_TARGET_COUNT})
                  </>
                ) : (
                  <>
                    <Crosshair className="h-4 w-4 mr-2" />
                    {tapUv ? "이 위치 GPS 측정 (3.5초 평균)" : "먼저 도면에서 내 위치를 탭하세요"}
                  </>
                )}
              </Button>
            </div>

            {points.length > 0 && (
              <Card>
                <CardContent className="p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">측정된 지점 ({points.length}곳 · 권장 3~4곳)</span>
                    <button
                      type="button"
                      className="text-[11px] text-muted-foreground hover:text-destructive underline"
                      onClick={() => {
                        setPoints([]);
                        setSavedNotice(null);
                      }}
                    >
                      전체 초기화
                    </button>
                  </div>
                  <ul className="space-y-1.5">
                    {points.map((p, idx) => {
                      const resM =
                        liveFit && !("error" in liveFit) ? liveFit.residualsM[idx] : null;
                      const highErr = resM != null && resM > 10;
                      return (
                        <li
                          key={p.id}
                          className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 bg-background"
                        >
                          <div className="min-w-0">
                            <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                              ✓#{p.label}
                            </span>{" "}
                            <span className="text-muted-foreground">
                              ±{Math.round(p.accuracy_m)}m ({p.sampleCount}샘플)
                            </span>
                            {resM != null && (
                              <span
                                className={`ml-1.5 font-medium ${
                                  highErr ? "text-destructive" : "text-emerald-700 dark:text-emerald-300"
                                }`}
                              >
                                · 오차 {resM.toFixed(1)}m
                              </span>
                            )}
                          </div>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => removePoint(p.id)}
                            title="이 지점 삭제"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>

                  {liveFit && "error" in liveFit && (
                    <p className="text-destructive text-[11px] pt-1">{liveFit.error}</p>
                  )}

                  {liveFit && !("error" in liveFit) && (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-[11px] space-y-0.5">
                      <div className="font-semibold text-emerald-800 dark:text-emerald-200">
                        예상 보정 오차 RMS ≈ {liveFit.rmsM.toFixed(1)}m (최대{" "}
                        {liveFit.maxResidualM.toFixed(1)}m)
                      </div>
                      <div className="text-muted-foreground">
                        추정 도면 크기 {Math.round(liveFit.widthM)}m × {Math.round(liveFit.heightM)}m
                        · 회전 {liveFit.rotationDeg}°
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Button
              className="h-12 w-full"
              variant={liveFit && !("error" in liveFit) ? "default" : "secondary"}
              disabled={busy || capturing || !liveFit || "error" in liveFit || !projectId}
              onClick={() => void applyWalkFit()}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Footprints className="h-4 w-4 mr-2" />
              )}
              {points.length < 3
                ? `맵에 저장 (최소 3곳 필요 · 현재 ${points.length}곳)`
                : `${points.length}개 지점으로 현장맵 GPS 저장`}
            </Button>

            {savedNotice && (
              <Card className="border-emerald-500/50 bg-emerald-500/10">
                <CardContent className="p-3 text-xs space-y-1">
                  <div className="font-semibold text-emerald-800 dark:text-emerald-200 flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4" />
                    저장 완료 (RMS ≈ {savedNotice.rmsM.toFixed(1)}m · {Math.round(savedNotice.widthM)}m ×{" "}
                    {Math.round(savedNotice.heightM)}m)
                  </div>
                  <p className="text-muted-foreground">
                    지금 현장을 몇 걸음 걸어 다니면서 위 도면의 <b>파란 ‘내 GPS’ 점</b>이 실제 위치와
                    정확히 따라오는지 확인해 보세요.
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {mode === "bias" && (
          <>
            <Card className="border-rose-500/30 bg-rose-500/5">
              <CardContent className="p-3 text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-medium">
                  <Crosshair className="h-3.5 w-3.5 text-rose-600" />
                  {liveWatching ? "실시간 GPS 수신 중" : "GPS 대기…"}
                  {liveGps && (
                    <Badge variant="secondary" className="text-[10px] ml-auto">
                      ±{Math.round(liveGps.accuracy)}m
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground">
                  분홍 = 폰 GPS가 가리키는 자리 · 파란 = 내가 탭한 참위치
                </p>
                {tapUv && previewOffsetM != null && (
                  <p className="text-foreground">
                    예상 보정량 ≈ <b>{Math.round(previewOffsetM)}m</b>
                    {previewOffsetM > GPS_CAL_MAX_OFFSET_M && (
                      <span className="text-destructive"> (한도 초과)</span>
                    )}
                  </p>
                )}
              </CardContent>
            </Card>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {tapUv
                ? "참위치 선택됨 — 저장하면 3.5초 평균 GPS로 오프셋을 계산합니다"
                : "지금 서 있는 자리를 도면에서 탭하세요"}
            </p>
            {existing && (
              <Card className="border-emerald-500/40 bg-emerald-500/5">
                <CardContent className="p-3 text-xs space-y-1">
                  <div className="font-medium text-emerald-800 dark:text-emerald-200">
                    1점 미세 보정 적용 중
                  </div>
                  <div className="text-muted-foreground">
                    ≈{previewMag != null ? Math.round(previewMag) : "?"}m · GPS ±
                    {Math.round(existing.accuracy_m)}m
                  </div>
                </CardContent>
              </Card>
            )}
            <div className="grid gap-2">
              <Button
                className="h-12"
                disabled={
                  busy ||
                  !tapUv ||
                  !corners ||
                  !projectId ||
                  (previewOffsetM != null && previewOffsetM > GPS_CAL_MAX_OFFSET_M)
                }
                onClick={() => void saveBias()}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Crosshair className="h-4 w-4 mr-2" />
                )}
                1점 미세 보정 저장
              </Button>
              <Button
                variant="outline"
                className="h-11"
                disabled={busy || !existing || !projectId}
                onClick={() => void clearBias()}
              >
                <Trash2 className="h-4 w-4 mr-2" /> 정렬 보정 초기화
              </Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
