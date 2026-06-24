import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Activity, Satellite, Wifi, QrCode, AlertTriangle } from "lucide-react";

type Evt = { source: string | null; accuracy_m: number | null; zone_id: string | null; created_at: string };

export default function AdminTrackingHealth() {
  const [projectId, setProjectId] = useState<string>(() => localStorage.getItem("currentProjectId") || "");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [events, setEvents] = useState<Evt[]>([]);
  const [zonesMissingFp, setZonesMissingFp] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    supabase.from("projects").select("id,name").then(({ data }) => setProjects(data || []));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    localStorage.setItem("currentProjectId", projectId);
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    supabase
      .from("worker_zone_events")
      .select("source, accuracy_m, zone_id, created_at")
      .eq("project_id", projectId)
      .gte("created_at", since)
      .then(({ data }) => setEvents((data || []) as Evt[]));
    supabase
      .from("site_zones")
      .select("id, name, wifi_fingerprint")
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .then(({ data }) =>
        setZonesMissingFp(
          (data || [])
            .filter((z: any) => !z.wifi_fingerprint || (Array.isArray(z.wifi_fingerprint) && z.wifi_fingerprint.length === 0))
            .map((z: any) => ({ id: z.id, name: z.name }))
        )
      );
  }, [projectId]);

  const stats = useMemo(() => {
    const bySource: Record<string, number> = { gps: 0, wifi: 0, qr: 0, manual: 0, unknown: 0 };
    let accSum = 0, accN = 0;
    for (const e of events) {
      bySource[e.source || "unknown"] = (bySource[e.source || "unknown"] || 0) + 1;
      if (typeof e.accuracy_m === "number") { accSum += e.accuracy_m; accN++; }
    }
    return {
      bySource,
      avgAccuracy: accN ? accSum / accN : 0,
      total: events.length,
    };
  }, [events]);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" /> 위치 추적 상태 점검
        </h1>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="w-56"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
          <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile icon={Satellite} label="GPS" value={stats.bySource.gps} tone="info" />
        <Tile icon={Wifi} label="Wi-Fi 매칭" value={stats.bySource.wifi} tone="primary" />
        <Tile icon={QrCode} label="QR" value={stats.bySource.qr} tone="muted" />
        <Tile
          icon={AlertTriangle}
          label="평균 정확도(m)"
          value={Math.round(stats.avgAccuracy)}
          tone={stats.avgAccuracy > 30 ? "danger" : "muted"}
        />
      </div>

      <Card>
        <CardHeader><CardTitle>최근 24시간 — 총 {stats.total}건</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          평균 정확도가 30m를 넘으면 Wi-Fi 핑거프린트 보강을 권장합니다. GPS 비중이 매우 낮으면 근로자 위치 권한이 거부됐을 가능성이 있습니다.
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Wi-Fi 지문 미수집 구역 ({zonesMissingFp.length})</CardTitle></CardHeader>
        <CardContent>
          {zonesMissingFp.length === 0 ? (
            <div className="text-sm text-muted-foreground">모든 구역에 Wi-Fi 지문이 등록되어 있습니다.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {zonesMissingFp.map((z) => (
                <Badge key={z.id} variant="outline">{z.name}</Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: "primary" | "info" | "danger" | "muted" }) {
  const cls =
    tone === "danger" ? "text-destructive"
      : tone === "primary" ? "text-primary"
      : tone === "info" ? "text-blue-600"
      : "text-muted-foreground";
  return (
    <Card><CardContent className="p-4 flex items-center gap-3">
      <Icon className={`h-7 w-7 ${cls}`} />
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-bold ${cls}`}>{value}</div>
      </div>
    </CardContent></Card>
  );
}
