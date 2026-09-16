import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MapPin, Plus, Trash2 } from "lucide-react";
import {
  SITE_SPOT_DEFAULT_RADIUS_M,
  SITE_SPOT_MIN_RADIUS_M,
  SITE_TRACK_MAX_M,
  clampSiteSpotRadiusM,
  type ProjectSiteSpotRow,
} from "@/lib/tracking/siteTrackBounds";

type SpotForm = {
  name: string;
  center_lat: string;
  center_lng: string;
  radius_m: string;
};

const emptyForm = (): SpotForm => ({
  name: "",
  center_lat: "",
  center_lng: "",
  radius_m: String(SITE_SPOT_DEFAULT_RADIUS_M),
});

export default function ProjectSiteSpotsCard({
  projectId,
  pinLat,
  pinLng,
  canEdit,
  onToast,
}: {
  projectId: string;
  pinLat?: number | null;
  pinLng?: number | null;
  canEdit: boolean;
  onToast: (opts: { title: string; description?: string; variant?: "destructive" }) => void;
}) {
  const [spots, setSpots] = useState<ProjectSiteSpotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<SpotForm>(emptyForm());

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("project_site_spots" as any)
      .select("id, project_id, name, center_lat, center_lng, radius_m, sort_order")
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) {
      setSpots([]);
    } else {
      setSpots((data || []) as ProjectSiteSpotRow[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!projectId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const fillFromPin = () => {
    if (typeof pinLat !== "number" || typeof pinLng !== "number") {
      onToast({ title: "주소핀 좌표가 없습니다. 현장주소를 먼저 저장하세요.", variant: "destructive" });
      return;
    }
    setForm((prev) => ({
      ...prev,
      center_lat: String(pinLat),
      center_lng: String(pinLng),
    }));
  };

  const fillFromGps = () => {
    if (!("geolocation" in navigator)) {
      onToast({ title: "이 기기에서 GPS를 쓸 수 없습니다.", variant: "destructive" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((prev) => ({
          ...prev,
          center_lat: pos.coords.latitude.toFixed(6),
          center_lng: pos.coords.longitude.toFixed(6),
        }));
      },
      () => onToast({ title: "현재 위치를 잡지 못했습니다.", variant: "destructive" }),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  const handleAdd = async () => {
    const name = form.name.trim();
    const lat = Number(form.center_lat);
    const lng = Number(form.center_lng);
    const radius = clampSiteSpotRadiusM(Number(form.radius_m));
    if (!name) {
      onToast({ title: "개소 이름을 입력하세요.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      onToast({ title: "위도·경도를 숫자로 입력하세요.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("project_site_spots" as any).insert({
      project_id: projectId,
      name,
      center_lat: lat,
      center_lng: lng,
      radius_m: radius,
      sort_order: spots.length,
    });
    setSaving(false);
    if (error) {
      onToast({ title: "개소 저장 실패", description: error.message, variant: "destructive" });
      return;
    }
    setForm(emptyForm());
    await load();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from("project_site_spots" as any)
      .update({ is_deleted: true, is_active: false })
      .eq("id", id);
    if (error) {
      onToast({ title: "개소 삭제 실패", description: error.message, variant: "destructive" });
      return;
    }
    await load();
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" />
          GPS 개소
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          한 프로젝트 안의 출근·체류 위치입니다. 근로자는 고르지 않고 GPS가 가까운 개소를 잡습니다.
          비어 있으면 지금처럼 현장맵·주소핀 원 하나를 씁니다. TBM·허가서는 프로젝트 공통입니다.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-xs text-muted-foreground">불러오는 중…</p>
        ) : spots.length === 0 ? (
          <p className="text-xs text-muted-foreground">등록된 개소가 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {spots.map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-2 rounded-md border p-2">
                <div className="text-sm min-w-0">
                  <div className="font-medium truncate">{s.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {Number(s.center_lat).toFixed(5)}, {Number(s.center_lng).toFixed(5)} · 반경 {Math.round(Number(s.radius_m))}m
                  </div>
                </div>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-destructive shrink-0"
                    onClick={() => void handleDelete(s.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {canEdit && (
          <div className="space-y-3 rounded-md border bg-muted/30 p-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs">개소 이름</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="예: H2 패드, 적량동 사무실"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">위도</Label>
                <Input
                  value={form.center_lat}
                  onChange={(e) => setForm((p) => ({ ...p, center_lat: e.target.value }))}
                  placeholder="34.85125"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">경도</Label>
                <Input
                  value={form.center_lng}
                  onChange={(e) => setForm((p) => ({ ...p, center_lng: e.target.value }))}
                  placeholder="127.70013"
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs">반경 (m, {SITE_SPOT_MIN_RADIUS_M}–{SITE_TRACK_MAX_M})</Label>
                <Input
                  type="number"
                  min={SITE_SPOT_MIN_RADIUS_M}
                  max={SITE_TRACK_MAX_M}
                  value={form.radius_m}
                  onChange={(e) => setForm((p) => ({ ...p, radius_m: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="text-xs" type="button" onClick={fillFromPin}>
                주소핀 좌표
              </Button>
              <Button size="sm" variant="outline" className="text-xs" type="button" onClick={fillFromGps}>
                내 GPS
              </Button>
              <Button size="sm" className="text-xs gap-1" type="button" onClick={() => void handleAdd()} disabled={saving}>
                <Plus className="h-3.5 w-3.5" />
                {saving ? "저장 중…" : "개소 추가"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
