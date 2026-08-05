/**
 * Master: map↔GPS align
 * - 1점: residual phone bias
 * - 워킹: fixed slots A/B/C (labels never recycled) → capture GPS → fit geo_transform
 *
 * Bugfix: previously recommendControlPoints re-labeled every refresh as A/B/C,
 * so capturing "B" could overwrite captured "A" when ids collided.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  withSlotLabels,
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

/** One walk target — label is permanent for the session. */
type WalkSlot = {
  label: string;
  u: number;
  v: number;
  reason: string;
  status: "pending" | "done";
  lat?: number;
  lng?: number;
  accuracy_m?: number;
};

const SLOT_LABELS = ["A", "B", "C"] as const;

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

function buildSlots(
  zoneRingsUv: { u: number; v: number }[][],
  gpsHistoryUv: { u: number; v: number }[],
  excluded: { u: number; v: number }[] = [],
): WalkSlot[] {
  const recs = withSlotLabels(
    recommendControlPoints({
      count: SLOT_LABELS.length,
      excluded,
      captured: [],
      zoneRingsUv,
      gpsHistoryUv,
    }),
    [...SLOT_LABELS],
  );
  return SLOT_LABELS.map((label, i) => {
    const r = recs[i];
    return {
      label,
      u: r?.u ?? 0.25 + i * 0.25,
      v: r?.v ?? 0.35,
      reason: r?.reason ?? "맵 분산 후보",
      status: "pending" as const,
    };
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

  const [zoneRingsUv, setZoneRingsUv] = useState<{ u: number; v: number }[][]>([]);
  const [gpsHistoryUv, setGpsHistoryUv] = useState<{ u: number; v: number }[]>([]);
  const [excluded, setExcluded] = useState<{ u: number; v: number }[]>([]);
  const [slots, setSlots] = useState<WalkSlot[]>([]);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [fitPreview, setFitPreview] = useState<{ rmsM: number } | null>(null);

  /** Prevent reload from wiping in-progress walk captures. */
  const walkDirtyRef = useRef(false);
  const loadedMapRef = useRef<string>("");

  const active = maps.find((m) => m.id === mapId) || null;
  const corners = active ? loadCornersFromMap(active as any) : null;

  const pendingSlots = useMemo(() => slots.filter((s) => s.status === "pending"), [slots]);
  const doneSlots = useMemo(() => slots.filter((s) => s.status === "done"), [slots]);
  const activeSlot =
    slots.find((s) => s.label === activeLabel && s.status === "pending") ||
    pendingSlots[0] ||
    null;

  const initOrPreserveSlots = useCallback(
    (
      rings: { u: number; v: number }[][],
      hist: { u: number; v: number }[],
      opts: { force: boolean; mapChanged: boolean },
    ) => {
      if (!opts.force && walkDirtyRef.current && !opts.mapChanged) {
        return; // keep A/B/C captures
      }
      walkDirtyRef.current = false;
      setExcluded([]);
      setFitPreview(null);
      const next = buildSlots(rings, hist, []);
      setSlots(next);
      setActiveLabel(next.find((s) => s.status === "pending")?.label || next[0]?.label || null);
    },
    [],
  );

  const reload = useCallback(
    async (opts?: { forceWalkReset?: boolean }) => {
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
      const chosenId = mapId || list[0]?.id || "";
      if (!mapId && list[0]?.id) setMapId(list[0].id);
      setExisting(
        parseGpsCalibration((proj as { gps_calibration?: unknown } | null)?.gps_calibration),
      );

      const mapRow = list.find((m) => m.id === chosenId) || list[0];
      const c = mapRow ? loadCornersFromMap(mapRow as any) : null;

      let rings: { u: number; v: number }[][] = [];
      let hist: { u: number; v: number }[] = [];

      if (c) {
        const [{ data: zones }, { data: positions }] = await Promise.all([
          supabase
            .from("restricted_zones")
            .select("geo_polygon, geometry_type, center_lat, center_lng, radius_m")
            .eq("project_id", projectId)
            .eq("is_deleted", false)
            .limit(40),
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

      const mapChanged = loadedMapRef.current !== chosenId;
      if (chosenId) loadedMapRef.current = chosenId;
      initOrPreserveSlots(rings, hist, {
        force: !!opts?.forceWalkReset,
        mapChanged: mapChanged || !!opts?.forceWalkReset,
      });
    },
    [projectId, mapId, initOrPreserveSlots],
  );

  useEffect(() => {
    if (!isMaster) return;
    void reload();
  }, [isMaster, projectId]); // intentionally not mapId — map select handler calls reload

  const walkMarkers: MapMarker[] = useMemo(() => {
    return slots.map((s) => ({
      u: s.u,
      v: s.v,
      label: s.status === "done" ? `✓${s.label}` : s.label,
      tone:
        s.status === "done"
          ? "emerald"
          : s.label === activeSlot?.label
            ? "amber"
            : "blue",
    }));
  }, [slots, activeSlot?.label]);

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
    if (!activeSlot) {
      toast.error("남은 추천 지점이 없습니다");
      return;
    }
    const label = activeSlot.label;
    const uv = { u: activeSlot.u, v: activeSlot.v };
    setBusy(true);
    try {
      const raw = await getCurrentPosition();
      if (raw.accuracy > GPS_CAL_MAX_ACCURACY_M) {
        toast.error(
          `GPS 정확도 ±${Math.round(raw.accuracy)}m — ${GPS_CAL_MAX_ACCURACY_M}m 이하일 때 다시 시도하세요`,
        );
        return;
      }
      walkDirtyRef.current = true;
      setSlots((prev) => {
        const next = prev.map((s) =>
          s.label === label
            ? {
                ...s,
                status: "done" as const,
                u: uv.u,
                v: uv.v,
                lat: raw.lat,
                lng: raw.lng,
                accuracy_m: raw.accuracy,
              }
            : s,
        );
        const nextPending = next.find((s) => s.status === "pending");
        setActiveLabel(nextPending?.label || null);
        return next;
      });
      setFitPreview(null);
      const doneCount = doneSlots.length + 1;
      toast.success(
        `지점 ${label} 기록 완료 · GPS ±${Math.round(raw.accuracy)}m (${doneCount}/${SLOT_LABELS.length})`,
      );
    } catch (e: any) {
      toast.error(e?.message || "GPS 수신 실패");
    } finally {
      setBusy(false);
    }
  };

  const skipRecommendation = () => {
    if (!activeSlot) return;
    const label = activeSlot.label;
    const nextExcluded = [...excluded, { u: activeSlot.u, v: activeSlot.v }];
    setExcluded(nextExcluded);

    // Replace ONLY this slot's UV — keep label; never touch done slots.
    const blocked = [
      ...nextExcluded,
      ...slots.filter((s) => s.status === "done" || s.label !== label).map((s) => ({ u: s.u, v: s.v })),
    ];
    const [fresh] = recommendControlPoints({
      count: 1,
      excluded: blocked,
      zoneRingsUv,
      gpsHistoryUv,
    });
    if (!fresh) {
      toast.error("대체 추천 지점을 찾지 못했습니다");
      return;
    }
    walkDirtyRef.current = true;
    setSlots((prev) =>
      prev.map((s) =>
        s.label === label && s.status === "pending"
          ? { ...s, u: fresh.u, v: fresh.v, reason: fresh.reason || "대체 추천" }
          : s,
      ),
    );
    toast.message(`지점 ${label} 위치만 교체 · 라벨 ${label} 유지`);
  };

  const applyWalkFit = async () => {
    if (!projectId || !active) return;
    const captured: WalkControlPoint[] = slots
      .filter((s) => s.status === "done" && s.lat != null && s.lng != null)
      .map((s) => ({
        id: s.label,
        u: s.u,
        v: s.v,
        lat: s.lat!,
        lng: s.lng!,
        accuracy_m: s.accuracy_m,
      }));
    if (captured.length < 3) {
      toast.error("A·B·C 세 지점을 모두 찍어주세요");
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
      toast.success(`현장맵 지오레프 저장 · 잔차 RMS ≈${Math.round(fit.rmsM)}m`, {
        description:
          "A/B/C 기록은 유지됩니다. 다시 맞추려면 ‘워킹 초기화’ 후 재측정하세요.",
        duration: 7000,
      });
      // Refresh map meta but keep walk slots (forceWalkReset false via dirty)
      walkDirtyRef.current = true;
      await reload();
    } catch (e: any) {
      toast.error(e?.message || "저장 실패");
    } finally {
      setBusy(false);
    }
  };

  const resetWalk = () => {
    walkDirtyRef.current = false;
    initOrPreserveSlots(zoneRingsUv, gpsHistoryUv, { force: true, mapChanged: true });
    toast.message("워킹 보정 A/B/C를 새로 배정했습니다");
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
                  <b>A·B·C 라벨은 바뀌지 않습니다.</b> A를 찍은 뒤에도 A는 ✓A로 남고, 다음은
                  B입니다. 「여기 못 감」은 그 라벨의 위치만 교체합니다.
                </p>
                <p>
                  추천은 구역·최근 GPS·맵 분산 기준입니다. 핀을 탭해 미세 조정한 뒤 좌표를
                  잡으세요.
                </p>
              </>
            ) : (
              <>
                <p>워킹 보정 후 남는 수 m 오차만 1점으로 보정합니다.</p>
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
              const next = e.target.value;
              setMapId(next);
              setTapUv(null);
              walkDirtyRef.current = false;
              loadedMapRef.current = ""; // force slot rebuild for new map
              void reload({ forceWalkReset: true });
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
            marker={mode === "bias" ? tapUv : null}
            markers={mode === "walk" ? walkMarkers : undefined}
            onPick={(uv) => {
              if (mode === "bias") {
                setTapUv(uv);
                return;
              }
              if (!activeSlot) return;
              walkDirtyRef.current = true;
              const label = activeSlot.label;
              setSlots((prev) =>
                prev.map((s) =>
                  s.label === label && s.status === "pending"
                    ? { ...s, u: uv.u, v: uv.v, reason: `${s.reason} · 수동조정` }
                    : s,
                ),
              );
            }}
          />
        ) : (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              {maps.length === 0
                ? "등록된 현장 도면이 없습니다. PC 「통합 현장 관제맵」에서 도면을 먼저 업로드하세요."
                : mode === "bias"
                  ? "이 맵에 지오레프가 없습니다. 워킹 보정(권장)을 먼저 하세요. PC 위성 정렬은 선택입니다."
                  : "맵 이미지를 불러올 수 없습니다."}
            </CardContent>
          </Card>
        )}

        {mode === "walk" && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {slots.map((s) => (
                <Button
                  key={s.label}
                  size="sm"
                  variant={
                    s.status === "done"
                      ? "secondary"
                      : s.label === activeSlot?.label
                        ? "default"
                        : "outline"
                  }
                  className="h-8"
                  disabled={s.status === "done"}
                  onClick={() => setActiveLabel(s.label)}
                >
                  {s.status === "done" ? `✓${s.label}` : s.label}
                </Button>
              ))}
              <Badge variant="secondary" className="h-8 px-2 text-[10px]">
                완료 {doneSlots.length}/{SLOT_LABELS.length}
              </Badge>
            </div>

            {activeSlot && (
              <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  지금 목표: <b>{activeSlot.label}</b> · {activeSlot.reason}
                  <br />
                  그 자리에 서서 좌표를 잡으세요. 못 가면 위치만 교체됩니다 (라벨 유지).
                </span>
              </p>
            )}

            {doneSlots.length > 0 && (
              <Card className="border-emerald-500/30 bg-emerald-500/5">
                <CardContent className="p-3 text-xs space-y-1">
                  {doneSlots.map((c) => (
                    <div key={c.label}>
                      ✓{c.label} · ±{Math.round(c.accuracy_m || 0)}m ·{" "}
                      {c.lat!.toFixed(5)}, {c.lng!.toFixed(5)}
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
                disabled={busy || !activeSlot || !projectId}
                onClick={() => void captureWalkPoint()}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Crosshair className="h-4 w-4 mr-2" />
                )}
                {activeSlot
                  ? `지점 ${activeSlot.label} 좌표 잡기`
                  : "A·B·C 모두 기록됨"}
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className="h-11"
                  disabled={busy || !activeSlot}
                  onClick={skipRecommendation}
                >
                  <RefreshCw className="h-4 w-4 mr-1.5" /> 여기 못 감
                </Button>
                <Button
                  variant="outline"
                  className="h-11"
                  disabled={busy}
                  onClick={resetWalk}
                >
                  워킹 초기화
                </Button>
              </div>
              <Button
                className="h-12"
                variant="secondary"
                disabled={busy || doneSlots.length < 3 || !projectId}
                onClick={() => void applyWalkFit()}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Footprints className="h-4 w-4 mr-2" />
                )}
                {doneSlots.length < 3
                  ? `맵에 적용 (아직 ${doneSlots.length}/3)`
                  : "A·B·C로 맵 지오레프 저장"}
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
