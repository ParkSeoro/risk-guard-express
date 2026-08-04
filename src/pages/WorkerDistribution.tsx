import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useGlobalProjectAccess } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Users, MapPin, Building2, Activity, Radio, RefreshCw } from "lucide-react";
import { isClientType } from "@/lib/companyTypes";

type SiteMap = { id: string; name: string; image_url: string | null };
type Zone = {
  id: string;
  site_map_id: string;
  name: string;
  zone_type: "normal" | "work" | "restricted" | "danger";
  color: string | null;
  polygon: { x: number; y: number }[];
};
type DistRow = {
  company_id: string | null;
  company_name: string | null;
  zone_id: string | null;
  headcount: number;
  stale_count: number;
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

function formatAgo(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  return `${h}시간`;
}

/**
 * 현장 근로자 분포도 — 회사/구역/인원만 표시 (이름·전화 비노출).
 * 발주처 SM/CM/PM·마스터: 전체 / 시공사·협력사: 접근 가능 회사 범위(RPC RLS).
 */
export default function WorkerDistribution() {
  const {
    projects,
    selectedProject,
    setSelectedProject,
    isMaster,
    userCompanyType,
    userRole,
  } = useGlobalProjectAccess();
  const projectId = selectedProject || "";
  const [maps, setMaps] = useState<SiteMap[]>([]);
  const [activeMap, setActiveMap] = useState<SiteMap | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [rows, setRows] = useState<DistRow[]>([]);
  const [lastSource, setLastSource] = useState<"realtime" | "polling" | "init">("init");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [rtStatus, setRtStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [nowTick, setNowTick] = useState(Date.now());
  const [loadError, setLoadError] = useState<string | null>(null);

  const canSeeFullSite =
    isMaster ||
    (isClientType(userCompanyType) &&
      (userRole === "project_admin" ||
        userRole === "safety_manager" ||
        userRole === "site_manager" ||
        userRole === "supervisor" ||
        userRole === "site_supervisor"));

  useEffect(() => {
    if (!projectId) return;
    loadMaps();
    loadCounts("polling");
    setRtStatus("connecting");
    const ch = supabase
      .channel(`wd:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "worker_last_positions", filter: `project_id=eq.${projectId}` },
        () => loadCounts("realtime"),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRtStatus("connected");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setRtStatus("disconnected");
        }
      });
    const t = setInterval(() => loadCounts("polling"), 60000);
    const tick = setInterval(() => setNowTick(Date.now()), 1000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const loadMaps = async () => {
    const { data } = await supabase
      .from("site_maps")
      .select("id,name,image_url")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    const list = (data || []) as SiteMap[];
    setMaps(list);
    setActiveMap((prev) => (prev && list.find((m) => m.id === prev.id) ? prev : list[0] || null));
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

  const loadCounts = async (source: "realtime" | "polling" = "polling") => {
    if (!projectId) return;
    const { data, error } = await supabase.rpc("get_worker_distribution_counts" as any, {
      _project_id: projectId,
    });
    if (error) {
      setLoadError(error.message);
      setRows([]);
      return;
    }
    setLoadError(null);
    setRows(
      ((data as any[]) || []).map((r) => ({
        company_id: r.company_id,
        company_name: r.company_name,
        zone_id: r.zone_id,
        headcount: Number(r.headcount || 0),
        stale_count: Number(r.stale_count || 0),
      })),
    );
    setLastSource(source);
    setLastUpdated(new Date());
  };

  const { perZone, byCompany, totalIn, companyCount } = useMemo(() => {
    const perZone: Record<string, number> = {};
    const byCompany: Record<string, { name: string; total: number; zones: { zoneId: string | null; count: number }[] }> = {};
    let totalIn = 0;
    for (const r of rows) {
      totalIn += r.headcount;
      const zKey = r.zone_id || "unknown";
      perZone[zKey] = (perZone[zKey] || 0) + r.headcount;
      const cKey = r.company_id || "unknown";
      if (!byCompany[cKey]) {
        byCompany[cKey] = { name: r.company_name || "(미지정)", total: 0, zones: [] };
      }
      byCompany[cKey].total += r.headcount;
      byCompany[cKey].zones.push({ zoneId: r.zone_id, count: r.headcount });
    }
    return {
      perZone,
      byCompany,
      totalIn,
      companyCount: Object.keys(byCompany).length,
    };
  }, [rows]);

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
          <p className="text-sm text-muted-foreground">
            GPS 최근 위치 기반 · 회사/구역/인원만 표시 (개인정보 비노출)
            {!canSeeFullSite && " · 접근 가능 회사 범위"}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge
              variant={rtStatus === "connected" ? "default" : rtStatus === "connecting" ? "secondary" : "destructive"}
              className="text-[10px] gap-1"
            >
              <Radio className={`h-3 w-3 ${rtStatus === "connected" ? "animate-pulse" : ""}`} />
              {rtStatus === "connected" ? "Realtime 연결" : rtStatus === "connecting" ? "Realtime 연결중" : "Realtime 끊김"}
            </Badge>
            <Badge variant="outline" className="text-[10px] gap-1">
              마지막 갱신: {lastSource === "realtime" ? "Realtime" : lastSource === "polling" ? "폴링(60s)" : "초기"}
            </Badge>
            <Badge variant="outline" className="text-[10px] gap-1">
              <RefreshCw className="h-3 w-3" />
              {lastUpdated
                ? `${formatAgo(nowTick - lastUpdated.getTime())} 전 (${lastUpdated.toLocaleTimeString("ko-KR")})`
                : "대기중"}
            </Badge>
          </div>
        </div>
        <div className="flex gap-2">
          <Select value={projectId} onValueChange={(v) => setSelectedProject(v)}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {maps.length > 0 && (
            <Select
              value={activeMap?.id || ""}
              onValueChange={(v) => setActiveMap(maps.find((m) => m.id === v) || null)}
            >
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="사이트맵 선택" /></SelectTrigger>
              <SelectContent>
                {maps.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {loadError && (
        <Card className="border-destructive/40">
          <CardContent className="pt-4 text-sm space-y-2">
            <div className="text-destructive font-medium">분포 데이터 로드 실패</div>
            <div className="text-destructive/90 text-xs break-all">{loadError}</div>
            {/company_type/i.test(loadError) ? (
              <div className="rounded-md border bg-muted/40 p-3 text-xs text-foreground space-y-1.5 leading-relaxed">
                <p className="font-semibold">지금 바로 고치는 방법 (앱 업데이트와 무관)</p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>Supabase Dashboard → SQL Editor 열기</li>
                  <li>
                    마이그레이션 파일{" "}
                    <code className="text-[10px]">20260804011000_fix_distribution_counts_company_type.sql</code>{" "}
                    내용을 붙여넣고 Run
                  </li>
                  <li>이 페이지를 새로고침</li>
                </ol>
                <p className="text-muted-foreground">
                  원인: RPC가 없는 컬럼 <code>companies.company_type</code>을 참조합니다. 실제 컬럼은{" "}
                  <code>companies.type</code> 입니다.
                </p>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                SQL 마이그레이션(`worker_last_positions` / `get_worker_distribution_counts`) 적용 여부를
                확인하세요.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard icon={Users} label="현재 현장 체류" value={totalIn} tone="primary" />
        <SummaryCard icon={MapPin} label="활성 구역" value={Object.keys(perZone).length} tone="info" />
        <SummaryCard icon={Building2} label="회사 수" value={companyCount} tone="muted" />
        <SummaryCard icon={Activity} label="구역 집계 행" value={rows.length} tone="muted" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>사이트맵 분포</CardTitle>
          </CardHeader>
          <CardContent>
            {!activeMap?.image_url ? (
              <div className="aspect-video bg-muted rounded flex items-center justify-center text-sm text-muted-foreground">
                {maps.length === 0
                  ? "등록된 사이트맵이 없습니다. (통합 현장 관제맵에서 등록)"
                  : "사이트맵을 선택하세요"}
              </div>
            ) : (
              <div className="relative w-full">
                <img src={activeMap.image_url} alt={activeMap.name} className="w-full h-auto rounded border" />
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
                  {zones.map((z) => {
                    const fill = z.color || ZONE_COLOR[z.zone_type];
                    const count = perZone[z.id] || 0;
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
              const count = perZone[z.id] || 0;
              const color = z.color || ZONE_COLOR[z.zone_type];
              return (
                <div key={z.id} className="border rounded p-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded" style={{ background: color }} />
                      <span className="font-medium">{z.name}</span>
                      <Badge variant="outline" className="text-[10px]">{ZONE_LABEL[z.zone_type]}</Badge>
                    </div>
                    <Badge>{count}명</Badge>
                  </div>
                </div>
              );
            })}
            {(perZone["unknown"] || 0) > 0 && (
              <div className="border rounded p-2 border-dashed">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-muted-foreground">미지정 구역</span>
                  <Badge variant="secondary">{perZone["unknown"]}명</Badge>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>회사 · 구역 인원 ({totalIn}명)</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(byCompany).length === 0 ? (
            <div className="text-sm text-muted-foreground">
              최근 12시간 내 GPS 위치가 없습니다. 앱에서 위치 추적이 켜진 근로자부터 집계됩니다.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="p-2">회사</th>
                    <th className="p-2">구역</th>
                    <th className="p-2 text-right">인원</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(byCompany)
                    .sort((a, b) => b.total - a.total)
                    .flatMap((c) =>
                      c.zones
                        .sort((a, b) => b.count - a.count)
                        .map((z, i) => (
                          <tr key={`${c.name}-${z.zoneId}-${i}`} className="border-t">
                            <td className="p-2 font-medium">{c.name}</td>
                            <td className="p-2">{z.zoneId ? (zoneById[z.zoneId]?.name || "기타") : "미지정"}</td>
                            <td className="p-2 text-right">{z.count}</td>
                          </tr>
                        )),
                    )}
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
