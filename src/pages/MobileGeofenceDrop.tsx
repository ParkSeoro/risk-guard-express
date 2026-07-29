import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNavigateMobileHome } from "@/lib/mobileNav";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, MapPin, Loader2, Crosshair } from "lucide-react";
import { toast } from "sonner";

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
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
}

/**
 * Mobile Walk & Drop: create a circular restricted_zone at current GPS.
 */
export default function MobileGeofenceDrop() {
  const navigate = useNavigate();
  const goMobileHome = useNavigateMobileHome();
  const { projectId } = useMobileAccess();
  const [name, setName] = useState("현장 지정 위험구역");
  const [radiusM, setRadiusM] = useState("15");
  const [fixing, setFixing] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const capture = async () => {
    setBusy(true);
    try {
      const pos = await getCurrentPosition();
      setFixing(pos);
      toast.success(`위치 확보 ±${Math.round(pos.accuracy)}m`);
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
    const { error } = await supabase.from("restricted_zones").insert({
      project_id: projectId,
      name: name.trim() || "현장 지정 위험구역",
      description: `Walk&Drop · accuracy ±${Math.round(fixing.accuracy)}m`,
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
    toast.success("현재 위치 반경 위험구역이 등록되었습니다");
    goMobileHome();
  };

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
          <CardContent className="pt-4 space-y-3 text-sm text-muted-foreground">
            위험 지점에 서서 버튼을 누르면, 현재 GPS 좌표를 중심으로 원형 지오펜스가 즉시 생성됩니다.
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
              <div>위도 {fixing.lat.toFixed(6)}</div>
              <div>경도 {fixing.lng.toFixed(6)}</div>
              <div className="text-muted-foreground">정확도 ±{Math.round(fixing.accuracy)}m</div>
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
