import { useEffect, useState } from "react";
import { useNavigateMobileHome } from "@/lib/mobileNav";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, MapPin, Loader2, Crosshair } from "lucide-react";
import { toast } from "sonner";
import {
  applyGpsCalibration,
  fetchProjectGpsCalibration,
  offsetMagnitudeM,
  type GpsCalibration,
} from "@/lib/tracking/gpsCalibration";

async function getCurrentPosition(): Promise<{ lat: number; lng: number; accuracy: number }> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      await Geolocation.requestPermissions();
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
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
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

type Fixing = {
  rawLat: number;
  rawLng: number;
  lat: number;
  lng: number;
  accuracy: number;
  calibrated: boolean;
};

/**
 * Mobile Walk & Drop: create a circular restricted_zone at current GPS
 * (map-aligned when project GPS calibration exists).
 */
export default function MobileGeofenceDrop() {
  const goMobileHome = useNavigateMobileHome();
  const { projectId } = useMobileAccess();
  const [name, setName] = useState("현장 지정 위험구역");
  const [radiusM, setRadiusM] = useState("15");
  const [fixing, setFixing] = useState<Fixing | null>(null);
  const [cal, setCal] = useState<GpsCalibration | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setCal(null);
      return;
    }
    let cancelled = false;
    void fetchProjectGpsCalibration(projectId, async (id) => {
      const { data } = await supabase.from("projects").select("gps_calibration").eq("id", id).maybeSingle();
      return data?.gps_calibration ?? null;
    }).then((c) => {
      if (!cancelled) setCal(c);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const capture = async () => {
    setBusy(true);
    try {
      const pos = await getCurrentPosition();
      let activeCal = cal;
      if (projectId) {
        activeCal = await fetchProjectGpsCalibration(projectId, async (id) => {
          const { data } = await supabase
            .from("projects")
            .select("gps_calibration")
            .eq("id", id)
            .maybeSingle();
          return data?.gps_calibration ?? null;
        });
        setCal(activeCal);
      }
      const aligned = applyGpsCalibration(pos.lat, pos.lng, activeCal);
      setFixing({
        rawLat: pos.lat,
        rawLng: pos.lng,
        lat: aligned.lat,
        lng: aligned.lng,
        accuracy: pos.accuracy,
        calibrated: aligned.calibrated,
      });
      toast.success(
        aligned.calibrated
          ? `맵 정렬 좌표 확보 ±${Math.round(pos.accuracy)}m (GPS 보정 적용)`
          : `위치 확보 ±${Math.round(pos.accuracy)}m`,
      );
    } catch (e: any) {
      toast.error(e?.message || "위치를 가져올 수 없습니다");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!projectId) {
      toast.error("프로젝트를 먼저 선택하세요");
      return;
    }
    if (!fixing) {
      toast.error("먼저 현재 위치를 확보하세요");
      return;
    }
    const r = Number(radiusM);
    if (!Number.isFinite(r) || r <= 0) {
      toast.error("반경(m)을 올바르게 입력하세요");
      return;
    }
    setBusy(true);
    const calNote = fixing.calibrated
      ? ` · GPS보정 적용 (raw ${fixing.rawLat.toFixed(6)},${fixing.rawLng.toFixed(6)})`
      : "";
    const { error } = await supabase.from("restricted_zones").insert({
      project_id: projectId,
      name: name.trim() || "현장 지정 위험구역",
      description: `Walk&Drop · accuracy ±${Math.round(fixing.accuracy)}m${calNote}`,
      geometry_type: "radius",
      geo_polygon: null,
      center_lat: fixing.lat,
      center_lng: fixing.lng,
      radius_m: r,
      banned_worker_ids: [],
      banned_company_ids: [],
      banned_job_types: [],
      is_active: true,
      created_by: (await supabase.auth.getUser()).data.user?.id,
    } as any);
    setBusy(false);
    if (error) {
      toast.error("저장 실패: " + error.message);
      return;
    }
    toast.success(
      fixing.calibrated
        ? "위험구역 등록 · PC 현장관제맵(도면)과 동일 좌표계"
        : "현재 위치 반경 위험구역이 등록되었습니다",
      {
        description: fixing.calibrated
          ? undefined
          : "맵·GPS 보정이 없으면 도면과 어긋날 수 있습니다. 마스터가 먼저 보정을 저장하세요.",
        duration: 5000,
      },
    );
    goMobileHome();
  };

  const calMag =
    cal != null ? Math.round(offsetMagnitudeM(cal.d_lat, cal.d_lng, cal.map_lat || 37)) : null;

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      <header className="bg-destructive text-destructive-foreground p-4 flex items-center gap-3 sticky top-0 z-10">
        <Button
          size="icon"
          variant="ghost"
          className="text-destructive-foreground hover:bg-destructive/80"
          onClick={() => goMobileHome()}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="font-bold text-lg flex-1">원터치 위험구역 (Walk & Drop)</div>
      </header>

      <main className="p-4 space-y-4 max-w-md mx-auto">
        <Card>
          <CardContent className="pt-4 space-y-2 text-sm text-muted-foreground">
            <p>
              위험 지점에 서서 버튼을 누르면, 현재 GPS를 중심으로 원형 지오펜스가 생성됩니다.
              PC 현장관제맵·근로자 위치와 맞추려면 <b>맵 정렬 좌표</b>(GPS 보정)를 사용합니다.
            </p>
            {cal ? (
              <Badge variant="secondary" className="text-[10px]">
                GPS 보정 적용 중 ≈{calMag}m
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-500/50">
                GPS 보정 없음 — 도면과 어긋날 수 있음
              </Badge>
            )}
          </CardContent>
        </Card>

        <div className="space-y-1.5">
          <Label>구역 이름</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-11" />
        </div>
        <div className="space-y-1.5">
          <Label>반경 (m)</Label>
          <Input
            type="number"
            inputMode="decimal"
            value={radiusM}
            onChange={(e) => setRadiusM(e.target.value)}
            className="h-11"
          />
        </div>

        {fixing && (
          <Card className="border-primary/40 bg-primary/5">
            <CardContent className="pt-4 text-sm space-y-1 font-mono">
              <div className="font-sans text-xs text-muted-foreground mb-1">
                {fixing.calibrated ? "맵 정렬 좌표 (저장값)" : "원시 GPS (저장값)"}
              </div>
              <div>위도 {fixing.lat.toFixed(6)}</div>
              <div>경도 {fixing.lng.toFixed(6)}</div>
              {fixing.calibrated && (
                <div className="text-[11px] text-muted-foreground font-sans pt-1">
                  raw {fixing.rawLat.toFixed(6)}, {fixing.rawLng.toFixed(6)}
                </div>
              )}
              <div className="text-muted-foreground font-sans">정확도 ±{Math.round(fixing.accuracy)}m</div>
            </CardContent>
          </Card>
        )}

        <Button className="w-full h-14 text-base" onClick={capture} disabled={busy}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Crosshair className="h-5 w-5 mr-2" />}
          내 위치 확보
        </Button>

        <Button
          className="w-full h-16 text-base font-bold bg-destructive hover:bg-destructive/90"
          onClick={save}
          disabled={busy || !fixing}
        >
          <MapPin className="h-6 w-6 mr-2" />
          내 위치를 위험 구역으로 설정
        </Button>
      </main>
    </div>
  );
}
