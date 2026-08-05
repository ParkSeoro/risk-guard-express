/**
 * Master: map↔GPS align
 * - 1점: residual phone bias (Phase A)
 * - 워킹: system recommends accessible points → capture GPS → fit geo_transform
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigateMobileHome } from "@/lib/mobileNav";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Crosshair,
  Loader2,
  MapPin,
  RefreshCw,
  Trash2,
  Footprints,
} from "lucide-react";
import { toast } from "sonner";
import { cornersToPersistPayload, loadCornersFromMap } from "@/lib/mapBounds";
import { latLngToUv, uvToLatLng } from "@/lib/tracking/imageSpaceGeo";
import ZoomableSiteMapImage, {
  type MapMarker,
} from "@/components/geofence/ZoomableSiteMapImage";
import {
  clearGpsCalibrationCache,
  computeGpsOffset,
  GPS_CAL_MAX_ACCURACY_M,
  GPS_CAL_MAX_OFFSET_M,
  offsetMagnitudeM,
  parseGpsCalibration,
  type GpsCalibration,
} from "@/lib/tracking/gpsCalibration";
import {
  recommendControlPoints,
  type ControlPointCandidate,
} from "@/lib/tracking/recommendControlPoints";
import {
  fitAffineFromControlPoints,
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
  const goHome = useNavigateMobileHome();
  const { hasRole, user } = useAuth();
  const { projectId } = useMobileAccess();
  const isMaster = hasRole("master");

  const [mode, setMode] = useState<Mode>("walk");
  const [maps, setMaps] = useState<SiteMapRow[]>([]);
  const [mapId, setMapId] = useState("");
  const [existing, setExisting] = useState<GpsCalibration | null>(null);
  const [tapUv, setTapUv] = useState<{ u: number; v: number } | null>(null);
  const [busy, setBusy] = useState(false);

  // Walk mode
  const [zoneRingsUv, setZoneRingsUv] = useState<{ u: number; v: number }[][]>([]);
  const [gpsHistoryUv, setGpsHistoryUv] = useState<{ u: number; v: number }[]>([]);
  const [excluded, setExcluded] = useState<{ u: number; v: number }[]>([]);
  const [recommendations, setRecommendations] = useState<ControlPointCandidate[]>([]);
  const [activeRecId, setActiveRecId] = useState<string | null>(null);
  const [captured, setCaptured] = useState<WalkControlPoint[]>([]);
  const [fitPreview, setFitPreview] = useState<{ rmsM: number } | null>(null);

  const active = maps.find((m) => m.id === mapId) || null;
  const corners = active ? loadCornersFromMap(active as any) : null;

  const rebuildRecommendations = useCallback(
    (extraExcluded: { u: number; v: number }[] = [], capturedPts: WalkControlPoint[] = captured) => {
      const next = recommendControlPoints({
        count: 3,
        excluded: [...excluded, ...extraExcluded],
        captured: capturedPts.map((c) => ({ u: c.u, v: c.v })),
        zoneRingsUv,
        gpsHistoryUv,
      });
      setRecommendations(next);
      setActiveRecId((prev) => {
        if (prev && next.some((n) => n.id === prev)) return prev;
        return next[0]?.id || null;
      });
    },
    [excluded, captured, zoneRingsUv, gpsHistoryUv],
  );

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
    const mid = mapId || list[0]?.id || "";
    setMapId((prev) => prev || list[0]?.id || "");
    setExisting(parseGpsCalibration((proj as { gps_calibration?: unknown } | null)?.gps_calibration));

    const mapRow = list.find((m) => m.id === (mapId || list[0]?.id)) || list[0];
    const c = mapRow ? loadCornersFromMap(mapRow as any) : null;

    let rings: { u: number; v: number }[][] = [];
    let hist: { u: number; v: number }[] = [];

    // Accessibility hints need an existing georef to project WGS84 → UV.
    // First-time maps: fall back to pure UV spread (no zone/GPS bias).
    if (c) {
      const [{ data: zones }, { data: positions }] = await Promise.all([
        supabase
          .from("restricted_zones")
          .select("geo_polygon, geometry_type, center_lat, center_lng, radius_m")
          .eq("project_id", projectId)
          .eq("is_deleted", false)
          .limit(40),
        // Table may lag generated types — cast query builder.
        (supabase as any)
          .from("worker_last_positions")
          .select("lat, lng")
          .eq("project_id", projectId)
          .order("updated_at", { ascending: false })
          .limit(40),
      ]);

      for (const z of (zones || []) as any[]) {
        const gp = z?.geo_polygon;
        if (Array.isArray(gp) && gp.length >= 3) {
          rings.push(
            gp
              .filter((p: any) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))
              .map((p: any) => latLngToUv({ lat: Number(p.lat), lng: Number(p.lng) }, c)),
          );
        } else {
          const clat = Number(z?.center_lat);
          const clng = Number(z?.center_lng);
          if (Number.isFinite(clat) && Number.isFinite(clng)) {
            rings.push([latLngToUv({ lat: clat, lng: clng }, c)]);
          }
        }
      }

      hist = ((positions as any[]) || [])
        .map((p) => latLngToUv({ lat: Number(p.lat), lng: Number(p.lng) }, c))
        .filter((uv) => uv.u >= 0 && uv.u <= 1 && uv.v >= 0 && uv.v <= 1);
    }

    setZoneRingsUv(rings);
    setGpsHistoryUv(hist);

    const recs = recommendControlPoints({
      count: 3,
      excluded: [],
      captured: [],
      zoneRingsUv: rings,
      gpsHistoryUv: hist,
    });
    setRecommendations(recs);
    setActiveRecId(recs[0]?.id || null);
    void mid;
  }, [projectId, mapId]);

  useEffect(() => {
    if (!isMaster) return;
    void reload();
  }, [isMaster, reload]);

  const activeRec = recommendations.find((r) => r.id === activeRecId) || null;

  const walkMarkers: MapMarker[] = useMemo(() => {
    const out: MapMarker[] = [];
    for (const r of recommendations) {
      out.push({
        u: r.u,
        v: r.v,
        label: r.id,
        tone: r.id === activeRecId ? "amber" : "blue",
      });
    }
    for (const c of captured) {
      out.push({ u: c.u, v: c.v, label: `✓${c.id}`, tone: "emerald" });
    }
    return out;
  }, [recommendations, activeRecId, captured]);

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

  const saveBias = async () => {
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
          `GPS 정확도 ±${Math.round(raw.accuracy)}m — ${GPS_CAL_MAX_ACCURACY_M}m 이하일 때만 저장합니다`,
        );
        return;
      }
      const { d_lat, d_lng } = computeGpsOffset(mapPt, raw);
      const mag = offsetMagnitudeM(d_lat, d_lng, mapPt.lat);
      if (mag > GPS_CAL_MAX_OFFSET_M) {
        toast.error(`보정량 ≈${Math.round(mag)}m 로 너무 큽니다 (한도 ${GPS_CAL_MAX_OFFSET_M}m)`);
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
      toast.success(`1점 보정 저장 · 약 ${Math.round(mag)}m`, { duration: 5000 });
    } catch (e: any) {
      toast.error(e?.message || "저장 실패");
    } finally {
      setBusy(false);
    }
  };

  const clearBias = async () => {
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
    toast.message("1점 보정을 초기화했습니다");
  };

  const captureWalkPoint = async () => {
    if (!activeRec) {
      toast.error("추천 지점을 선택하세요");
      return;
    }
    setBusy(true);
    try {
      const raw = await getCurrentPosition();
      if (raw.accuracy > GPS_CAL_MAX_ACCURACY_M) {
        toast.error(
          `GPS 정확도 ±${Math.round(raw.accuracy)}m — ${GPS_CAL_MAX_ACCURACY_M}m 이하일 때 다시 시도하세요`,
        );
        return;
      }
      const pt: WalkControlPoint = {
        id: activeRec.id,
        u: activeRec.u,
        v: activeRec.v,
        lat: raw.lat,
        lng: raw.lng,
        accuracy_m: raw.accuracy,
      };
      const nextCaptured = [...captured.filter((c) => c.id !== pt.id), pt];
      setCaptured(nextCaptured);
      setFitPreview(null);

      // Drop this recommendation; pick next
      const remain = recommendations.filter((r) => r.id !== activeRec.id);
      if (remain.length > 0) {
        setRecommendations(remain);
        setActiveRecId(remain[0].id);
      } else if (nextCaptured.length < 3) {
        rebuildRecommendations([], nextCaptured);
      } else {
        setRecommendations([]);
        setActiveRecId(null);
      }

      toast.success(
        `지점 ${pt.id} 기록 · GPS ±${Math.round(raw.accuracy)}m (${nextCaptured.length}/3+)`,
      );
    } catch (e: any) {
      toast.error(e?.message || "GPS 수신 실패");
    } finally {
      setBusy(false);
    }
  };

  const skipRecommendation = () => {
    if (!activeRec) return;
    const nextExcluded = [...excluded, { u: activeRec.u, v: activeRec.v }];
    setExcluded(nextExcluded);
    const next = recommendControlPoints({
      count: Math.max(3 - captured.length, 1),
      excluded: nextExcluded,
      captured: captured.map((c) => ({ u: c.u, v: c.v })),
      zoneRingsUv,
      gpsHistoryUv,
    });
    setRecommendations(next);
    setActiveRecId(next[0]?.id || null);
    toast.message(`지점 ${activeRec.id} 제외 · 다른 추천으로 교체`);
  };

  const applyWalkFit = async () => {
    if (!projectId || !active) return;
    if (captured.length < 3) {
      toast.error("최소 3개 지점을 찍어주세요");
      return;
    }
    setBusy(true);
    try {
      const fit = fitAffineFromControlPoints(captured);
      if ("error" in fit) {
        toast.error(fit.error);
        return;
      }
      const payload = cornersToPersistPayload(fit.corners, 0.85);
      const { error } = await supabase
        .from("site_maps")
        .update({
          ...payload,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", active.id);
      if (error) throw error;

      setFitPreview({ rmsM: fit.rmsM });
      toast.success(
        `현장맵 지오레프 저장 · 잔차 RMS ≈${Math.round(fit.rmsM)}m`,
        {
          description: "출근·추적·구역이 이 맵 기준을 사용합니다. 필요하면 1점 보정으로 잔여 오차를 줄이세요.",
          duration: 7000,
        },
      );
      await reload();
    } catch (e: any) {
      toast.error(e?.message || "저장 실패");
    } finally {
      setBusy(false);
    }
  };

  const resetWalk = () => {
    setCaptured([]);
    setExcluded([]);
    setFitPreview(null);
    rebuildRecommendations([], []);
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
          <p className="text-[11px] opacity-90">마스터 · 추천 워킹 / 1점 보정</p>
        </div>
        <Badge variant="secondary" className="text-[10px]">
          {mode === "walk" ? "워킹" : "1점"}
        </Badge>
      </header>

      <main className="p-4 space-y-3 max-w-lg mx-auto">
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={mode === "walk" ? "default" : "outline"}
            className="h-10"
            onClick={() => setMode("walk")}
          >
            <Footprints className="h-4 w-4 mr-1.5" /> 워킹 보정
          </Button>
          <Button
            variant={mode === "bias" ? "default" : "outline"}
            className="h-10"
            onClick={() => setMode("bias")}
          >
            <Crosshair className="h-4 w-4 mr-1.5" /> 1점 보정
          </Button>
        </div>

        <Card>
          <CardContent className="p-3 text-[11px] text-muted-foreground leading-relaxed space-y-1">
            {mode === "walk" ? (
              <>
                <p>
                  시스템이 <b>갈 수 있을 법한 위치</b>를 맵에서 추천합니다 (구역·최근 GPS·맵
                  분산). 모서리(산·하천)를 강제하지 않습니다.
                </p>
                <p>
                  추천 지점에 가서 <b>좌표 잡기</b> → 3점 이상이면 맵 지오레프를 계산·저장합니다.
                  못 가는 곳은 <b>여기 못 감</b>으로 교체하세요. 핀을 탭해 미세 조정할 수 있습니다.
                </p>
              </>
            ) : (
              <>
                <p>
                  도면 georef가 이미 맞을 때 <b>잔여 오차</b>만 1점으로 보정합니다.
                </p>
                <p>
                  GPS ≤{GPS_CAL_MAX_ACCURACY_M}m, 보정량 ≤{GPS_CAL_MAX_OFFSET_M}m 일 때만
                  저장됩니다.
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
              setMapId(e.target.value);
              setTapUv(null);
              setCaptured([]);
              setExcluded([]);
              setFitPreview(null);
              void reload();
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
            marker={mode === "bias" ? tapUv : activeRec}
            markers={mode === "walk" ? walkMarkers : undefined}
            onPick={(uv) => {
              if (mode === "bias") {
                setTapUv(uv);
                return;
              }
              // Fine-tune active recommendation pin
              if (!activeRecId) {
                setRecommendations((prev) => {
                  const id = prev[0]?.id || "A";
                  const next = [{ id, u: uv.u, v: uv.v, score: 1, reason: "수동 지정" }, ...prev.slice(1)];
                  setActiveRecId(id);
                  return next;
                });
                return;
              }
              setRecommendations((prev) =>
                prev.map((r) =>
                  r.id === activeRecId
                    ? { ...r, u: uv.u, v: uv.v, reason: `${r.reason} · 수동조정` }
                    : r,
                ),
              );
            }}
          />
        ) : (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              {maps.length === 0
                ? "등록된 사이트맵이 없습니다. PC 현장통제맵에서 드론 맵을 먼저 올리세요."
                : mode === "bias"
                  ? "이 맵에 TL/TR/BL 좌표가 없습니다. 워킹 보정으로 먼저 맞추거나 PC 맵핑을 저장하세요."
                  : "맵 이미지를 불러올 수 없습니다."}
            </CardContent>
          </Card>
        )}

        {mode === "walk" && (
          <>
            {recommendations.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {recommendations.map((r) => (
                  <Button
                    key={r.id}
                    size="sm"
                    variant={r.id === activeRecId ? "default" : "outline"}
                    className="h-8"
                    onClick={() => setActiveRecId(r.id)}
                  >
                    {r.id}
                  </Button>
                ))}
                <Badge variant="secondary" className="h-8 px-2 text-[10px]">
                  기록 {captured.length}점
                </Badge>
              </div>
            )}
            {activeRec && (
              <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  <b>{activeRec.id}</b> · {activeRec.reason}
                  <br />
                  해당 위치에 가서 좌표를 잡으세요. 못 가면 교체할 수 있습니다.
                </span>
              </p>
            )}
            {captured.length > 0 && (
              <Card className="border-emerald-500/30 bg-emerald-500/5">
                <CardContent className="p-3 text-xs space-y-1">
                  {captured.map((c) => (
                    <div key={c.id}>
                      ✓{c.id} · ±{Math.round(c.accuracy_m || 0)}m ·{" "}
                      {c.lat.toFixed(5)}, {c.lng.toFixed(5)}
                    </div>
                  ))}
                  {fitPreview && (
                    <div className="text-emerald-800 dark:text-emerald-200 font-medium pt-1">
                      마지막 적용 잔차 RMS ≈{Math.round(fitPreview.rmsM)}m
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
            <div className="grid gap-2">
              <Button
                className="h-12"
                disabled={busy || !activeRec || !projectId}
                onClick={() => void captureWalkPoint()}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Crosshair className="h-4 w-4 mr-2" />
                )}
                여기 좌표 잡기 {activeRec ? `(${activeRec.id})` : ""}
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className="h-11"
                  disabled={busy || !activeRec}
                  onClick={skipRecommendation}
                >
                  <RefreshCw className="h-4 w-4 mr-1.5" /> 여기 못 감
                </Button>
                <Button
                  variant="outline"
                  className="h-11"
                  disabled={busy || captured.length === 0}
                  onClick={resetWalk}
                >
                  워킹 초기화
                </Button>
              </div>
              <Button
                className="h-12"
                variant="secondary"
                disabled={busy || captured.length < 3 || !projectId}
                onClick={() => void applyWalkFit()}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Footprints className="h-4 w-4 mr-2" />
                )}
                {captured.length < 3
                  ? `맵에 적용 (아직 ${captured.length}/3)`
                  : `${captured.length}점으로 맵 지오레프 저장`}
              </Button>
            </div>
          </>
        )}

        {mode === "bias" && (
          <>
            {tapUv && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> 도면 지점 선택됨 — 그 자리에 서서 저장하세요
              </p>
            )}
            {existing && (
              <Card className="border-emerald-500/40 bg-emerald-500/5">
                <CardContent className="p-3 text-xs space-y-1">
                  <div className="font-medium text-emerald-800 dark:text-emerald-200">
                    1점 보정 적용 중
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
                disabled={busy || !tapUv || !corners || !projectId}
                onClick={() => void saveBias()}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Crosshair className="h-4 w-4 mr-2" />
                )}
                현재 GPS로 1점 보정 저장
              </Button>
              <Button
                variant="outline"
                className="h-11"
                disabled={busy || !existing || !projectId}
                onClick={() => void clearBias()}
              >
                <Trash2 className="h-4 w-4 mr-2" /> 1점 보정 초기화
              </Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
