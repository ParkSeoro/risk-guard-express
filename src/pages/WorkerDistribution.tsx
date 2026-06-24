import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Users, MapPin, ShieldAlert, Activity } from "lucide-react";

type SiteMap = { id: string; name: string; image_url: string | null };
type Zone = {
  id: string;
  site_map_id: string;
  name: string;
  zone_type: "normal" | "work" | "restricted" | "danger";
  color: string | null;
  polygon: { x: number; y: number }[];
};
type Evt = {
  id: string;
  zone_id: string | null;
  worker_name: string | null;
  worker_phone: string | null;
  event_type: string;
  created_at: string;
};

const ZONE_COLOR: Record<Zone["zone_type"], string> = {
  normal: "#10b981",
  work: "#3b82f6",
  restricted: "#f59e0b",
  danger: "#ef4444",
};
const ZONE_LABEL: Record<Zone["zone_type"], string> = {
  normal: "일반",
  work: "작업구역",
  restricted: "제한구역",
  danger: "위험구역",
};

export default function WorkerDistribution() {
  const [projectId, setProjectId] = useState<string>(() => localStorage.getItem("currentProjectId") || "");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [maps, setMaps] = useState<SiteMap[]>([]);
  const [activeMap, setActiveMap] = useState<SiteMap | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [events, setEvents] = useState<Evt[]>([]);

  useEffect(() => {
    supabase.from("projects").select("id,name").then(({ data }) => setProjects(data || []));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    localStorage.setItem("currentProjectId", projectId);
    loadMaps();
    loadEvents();
    const ch = supabase
      .channel(`wd:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "worker_zone_events", filter: `project_id=eq.${projectId}` },
        () => loadEvents()
      )
      .subscribe();
    const t = setInterval(loadEvents, 30000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, [projectId]);

  const loadMaps = async () => {
    const { data } = await supabase
      .from("site_maps")
      .select("id,name,image_url")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    const list = (data || []) as SiteMap[];
    setMaps(list);
    setActiveMap((prev) => prev && list.find((m) => m.id === prev.id) ? prev : list[0] || null);
  };

  useEffect(() => {
    if (!activeMap) {
      setZones([]);
      return;
    }
    supabase
      .from("site_zones")
      .select("*")
      .eq("site_map_id", activeMap.id)
      .then(({ data }) => setZones((data || []) as any as Zone[]));
  }, [activeMap]);

  const loadEvents = async () => {
    if (!projectId) return;
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from("worker_zone_events")
      .select("id,zone_id,worker_name,worker_phone,event_type,created_at")
      .eq("project_id", projectId)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: true })
      .limit(2000);
    setEvents((data || []) as Evt[]);
  };

  // Compute current occupancy per zone: per worker key, take the last event of the day.
  // If last is entry/unauthorized_entry -> currently in that zone.
  const { perZone, totalIn, dangerCount, residualWorkers } = useMemo(() => {
    const lastByWorker: Record<string, Evt> = {};
    for (const e of events) {
      const k = (e.worker_name || "?") + "|" + (e.worker_phone || "");
      lastByWorker[k] = e;
    }
    const perZone: Record<string, { name: string; phone: string | null; at: string }[]> = {};
    let totalIn = 0;
    let dangerCount = 0;
    const residual: { name: string; phone: string | null; zone_id: string | null; at: string; event_type: string }[] = [];
    for (const k of Object.keys(lastByWorker)) {
      const e = lastByWorker[k];
      if (e.event_type === "entry" || e.event_type === "unauthorized_entry") {
        totalIn += 1;
        const z = e.zone_id || "unknown";
        (perZone[z] ||= []).push({ name: e.worker_name || "(이름없음)", phone: e.worker_phone, at: e.created_at });
        residual.push({
          name: e.worker_name || "(이름없음)",
          phone: e.worker_phone,
          zone_id: e.zone_id,
          at: e.created_at,
          event_type: e.event_type,
        });
        if (e.event_type === "unauthorized_entry") dangerCount += 1;
      }
    }
    return { perZone, totalIn, dangerCount, residualWorkers: residual };
  }, [events]);

  const zoneById = useMemo(() => Object.fromEntries(zones.map((z) => [z.id, z])), [zones]);

  const polyToPoints = (poly: { x: number; y: number }[]) =>
    poly.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(" ");

  const centroid = (poly: { x: number; y: number }[]) => {
    if (!poly?.length) return { x: 50, y: 50 };
    const sx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
    const sy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
    return { x: sx * 100, y: sy * 100 };
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" /> 현장 근로자 분포도
          </h1>
          <p className="text-sm text-muted-foreground">QR 입·출 이벤트 기반 실시간 분포 (오늘 기준)</p>
        </div>
        <div className="flex gap-2">
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
            <SelectContent>
              {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {maps.length > 0 && (
            <Select value={activeMap?.id || ""} onValueChange={(v) => setActiveMap(maps.find((m) => m.id === v) || null)}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="사이트맵 선택" /></SelectTrigger>
              <SelectContent>
                {maps.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard icon={Users} label="현재 현장 체류" value={totalIn} tone="primary" />
        <SummaryCard icon={MapPin} label="활성 구역" value={Object.keys(perZone).length} tone="info" />
        <SummaryCard icon={ShieldAlert} label="위험구역 진입" value={dangerCount} tone={dangerCount > 0 ? "danger" : "muted"} />
        <SummaryCard icon={Activity} label="오늘 이벤트" value={events.length} tone="muted" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>사이트맵 분포</CardTitle>
          </CardHeader>
          <CardContent>
            {!activeMap?.image_url ? (
              <div className="aspect-video bg-muted rounded flex items-center justify-center text-sm text-muted-foreground">
                {maps.length === 0 ? "등록된 사이트맵이 없습니다. (현장 사이트맵/구역에서 등록)" : "사이트맵을 선택하세요"}
              </div>
            ) : (
              <div className="relative w-full">
                <img src={activeMap.image_url} alt={activeMap.name} className="w-full h-auto rounded border" />
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
                  {zones.map((z) => {
                    const fill = z.color || ZONE_COLOR[z.zone_type];
                    const count = (perZone[z.id] || []).length;
                    const c = centroid(z.polygon || []);
                    return (
                      <g key={z.id}>
                        <polygon
                          points={polyToPoints(z.polygon || [])}
                          fill={fill}
                          fillOpacity={count > 0 ? 0.35 : 0.12}
                          stroke={fill}
                          strokeWidth={0.4}
                          vectorEffect="non-scaling-stroke"
                        />
                        {count > 0 && (
                          <g>
                            <circle cx={c.x} cy={c.y} r={3.2} fill="#0f172a" />
                            <text
                              x={c.x}
                              y={c.y}
                              fill="#fff"
                              fontSize={3}
                              textAnchor="middle"
                              dominantBaseline="central"
                              fontWeight={700}
                            >
                              {count}
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {(["normal", "work", "restricted", "danger"] as const).map((t) => (
                <span key={t} className="inline-flex items-center gap-1">
                  <span className="w-3 h-3 rounded" style={{ background: ZONE_COLOR[t], opacity: 0.6 }} />
                  {ZONE_LABEL[t]}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>구역별 인원</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[520px] overflow-auto">
            {zones.length === 0 && <div className="text-sm text-muted-foreground">등록된 구역이 없습니다.</div>}
            {zones.map((z) => {
              const list = perZone[z.id] || [];
              const color = z.color || ZONE_COLOR[z.zone_type];
              return (
                <div key={z.id} className="border rounded p-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded" style={{ background: color }} />
                      <span className="font-medium">{z.name}</span>
                      <Badge variant="outline" className="text-[10px]">{ZONE_LABEL[z.zone_type]}</Badge>
                    </div>
                    <Badge>{list.length}명</Badge>
                  </div>
                  {list.length > 0 && (
                    <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-1">
                      {list.slice(0, 12).map((w, i) => (
                        <span key={i} className="px-1.5 py-0.5 bg-muted rounded">{w.name}</span>
                      ))}
                      {list.length > 12 && <span>외 {list.length - 12}명</span>}
                    </div>
                  )}
                </div>
              );
            })}
            {perZone["unknown"] && (
              <div className="border rounded p-2 border-dashed">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-muted-foreground">미지정 구역</span>
                  <Badge variant="secondary">{perZone["unknown"].length}명</Badge>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>현재 체류 근로자 ({residualWorkers.length}명)</CardTitle></CardHeader>
        <CardContent>
          {residualWorkers.length === 0 ? (
            <div className="text-sm text-muted-foreground">현재 체류 중인 근로자가 없습니다.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="p-2">이름</th>
                    <th className="p-2">연락처</th>
                    <th className="p-2">현재 구역</th>
                    <th className="p-2">진입 시각</th>
                    <th className="p-2">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {residualWorkers
                    .sort((a, b) => (a.at < b.at ? 1 : -1))
                    .map((w, i) => {
                      const z = w.zone_id ? zoneById[w.zone_id] : undefined;
                      return (
                        <tr key={i} className="border-t">
                          <td className="p-2 font-medium">{w.name}</td>
                          <td className="p-2 text-muted-foreground">{w.phone || "-"}</td>
                          <td className="p-2">{z?.name || "-"}</td>
                          <td className="p-2 text-muted-foreground">{new Date(w.at).toLocaleTimeString("ko-KR")}</td>
                          <td className="p-2">
                            {w.event_type === "unauthorized_entry"
                              ? <Badge variant="destructive">위험구역</Badge>
                              : <Badge variant="secondary">체류중</Badge>}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: any;
  label: string;
  value: number;
  tone: "primary" | "info" | "danger" | "muted";
}) {
  const toneCls =
    tone === "danger"
      ? "text-destructive"
      : tone === "primary"
      ? "text-primary"
      : tone === "info"
      ? "text-blue-600"
      : "text-muted-foreground";
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <Icon className={`h-8 w-8 ${toneCls}`} />
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className={`text-2xl font-bold ${toneCls}`}>{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
