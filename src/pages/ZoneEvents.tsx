import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ShieldAlert, LogIn, LogOut, Check, AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveProject } from "@/hooks/useActiveProject";
import { seoulDayRange, todaySeoulDate } from "@/lib/dailyWorkAck";
import {
  computeActiveDangerResiduals,
  computeLogRangeSinceIso,
  resolveInitialZoneEventsTab,
  resolveZoneEventName,
  type ZoneEventRecord,
  type ZoneEventTypeFilter,
  type ZoneLogRangePreset,
} from "@/lib/zoneEventsQuery";

const EVENT_SELECT =
  "id, project_id, zone_id, restricted_zone_id, worker_qr_id, worker_name, worker_phone, event_type, source, notes, acknowledged, acknowledged_by, acknowledged_at, created_at, restricted_zone:restricted_zones(name, zone_category, zone_color), zone:site_zones(name, zone_type, color)";

const EVENT_BADGE: Record<string, { label: string; color: string; icon: any }> = {
  entry: { label: "입장", color: "bg-primary/10 text-primary", icon: LogIn },
  exit: { label: "퇴장", color: "bg-muted text-foreground", icon: LogOut },
  unauthorized_entry: { label: "위험구역 진입", color: "bg-destructive/10 text-destructive", icon: ShieldAlert },
};

const RANGE_OPTIONS: Array<{ value: ZoneLogRangePreset; label: string }> = [
  { value: "today", label: "오늘" },
  { value: "7d", label: "최근 7일" },
  { value: "30d", label: "최근 30일" },
  { value: "all", label: "전체" },
];

const TYPE_OPTIONS: Array<{ value: ZoneEventTypeFilter; label: string }> = [
  { value: "all", label: "전체 유형" },
  { value: "unauthorized_entry", label: "위험구역 진입" },
  { value: "entry", label: "입장" },
  { value: "exit", label: "퇴장" },
];

export default function ZoneEvents() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const { projectId, setProjectId } = useActiveProject();
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [alerts, setAlerts] = useState<ZoneEventRecord[]>([]);
  const [residual, setResidual] = useState<ZoneEventRecord[]>([]);
  const [events, setEvents] = useState<ZoneEventRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"alerts" | "residual" | "all">(() =>
    resolveInitialZoneEventsTab(searchParams),
  );
  const [rangePreset, setRangePreset] = useState<ZoneLogRangePreset>("7d");
  const [typeFilter, setTypeFilter] = useState<ZoneEventTypeFilter>("all");

  // Respect push notification deep link (?project=<uuid>)
  useEffect(() => {
    const paramProject = searchParams.get("project");
    if (paramProject && paramProject !== projectId) {
      setProjectId(paramProject);
    }
  }, [searchParams, projectId, setProjectId]);

  useEffect(() => {
    supabase
      .from("projects")
      .select("id,name")
      .eq("is_deleted", false)
      .then(({ data }) => setProjects(data || []));
  }, []);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const todayKst = todaySeoulDate();
      const dayRange = seoulDayRange(todayKst);
      const sinceIso = computeLogRangeSinceIso(rangePreset, todayKst);

      // 1) Dedicated unacknowledged unauthorized_entry query — never crowded out by exit logs
      const alertsP = supabase
        .from("worker_zone_events")
        .select(EVENT_SELECT)
        .eq("project_id", projectId)
        .eq("event_type", "unauthorized_entry")
        .eq("acknowledged", false)
        .order("created_at", { ascending: false })
        .limit(200);

      // 2) Today's KST events for active danger-zone residual check
      const todayP = supabase
        .from("worker_zone_events")
        .select(EVENT_SELECT)
        .eq("project_id", projectId)
        .gte("created_at", dayRange.start)
        .lte("created_at", dayRange.end)
        .order("created_at", { ascending: false })
        .limit(500);

      // 3) Filtered full log (date preset + event type)
      let allQ = supabase
        .from("worker_zone_events")
        .select(EVENT_SELECT)
        .eq("project_id", projectId);
      if (sinceIso) {
        allQ = allQ.gte("created_at", sinceIso);
      }
      if (typeFilter !== "all") {
        allQ = allQ.eq("event_type", typeFilter);
      }
      const allP = allQ.order("created_at", { ascending: false }).limit(300);

      const [alertsRes, todayRes, allRes] = await Promise.all([alertsP, todayP, allP]);
      if (alertsRes.error) toast.error(alertsRes.error.message);
      if (todayRes.error) toast.error(todayRes.error.message);
      if (allRes.error) toast.error(allRes.error.message);

      setAlerts((alertsRes.data || []) as unknown as ZoneEventRecord[]);
      setResidual(
        computeActiveDangerResiduals((todayRes.data || []) as unknown as ZoneEventRecord[]),
      );
      setEvents((allRes.data || []) as unknown as ZoneEventRecord[]);
    } finally {
      setLoading(false);
    }
  }, [projectId, rangePreset, typeFilter]);

  useEffect(() => {
    if (!projectId) return;
    void load();
    const ch = supabase
      .channel(`wze:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "worker_zone_events",
          filter: `project_id=eq.${projectId}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [projectId, load]);

  const ack = async (id: string) => {
    const { data, error } = await supabase
      .from("worker_zone_events")
      .update({
        acknowledged: true,
        acknowledged_by: user?.id ?? null,
        acknowledged_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id");
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data || data.length === 0) {
      toast.error("확인 권한이 없거나 위반자 소속 회사가 아닙니다.");
      return;
    }
    toast.success("확인 처리되었습니다.");
    void load();
  };

  const renderRow = (e: ZoneEventRecord) => {
    const cfg = EVENT_BADGE[e.event_type] || EVENT_BADGE.entry;
    const Icon = cfg.icon;
    const zoneName = resolveZoneEventName(e);
    return (
      <div key={e.id} className="flex items-center gap-3 p-3 border-b text-sm">
        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="font-medium">
            {e.worker_name || "(이름없음)"}{" "}
            {e.worker_phone && (
              <span className="text-xs text-muted-foreground">· {e.worker_phone}</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {zoneName} · {new Date(e.created_at).toLocaleString("ko-KR")}
          </div>
        </div>
        <Badge className={cfg.color} variant="outline">
          {cfg.label}
        </Badge>
        {e.event_type === "unauthorized_entry" && !e.acknowledged && (
          <Button size="sm" variant="outline" onClick={() => void ack(e.id)}>
            <Check className="h-3 w-3 mr-1" /> 확인
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">구역 출입 모니터링</h1>
        </div>
        <div className="flex items-center gap-2">
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="프로젝트 선택" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            새로고침
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "alerts" | "residual" | "all")}>
        <TabsList>
          <TabsTrigger value="alerts">
            위험구역 경고{" "}
            {alerts.length > 0 && (
              <Badge className="ml-2 bg-destructive text-destructive-foreground">
                {alerts.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="residual">
            위험구역 현재 잔류{" "}
            {residual.length > 0 && <Badge className="ml-2">{residual.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="all">전체 로그</TabsTrigger>
        </TabsList>

        <TabsContent value="alerts">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" /> 미확인 무단 진입
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {alerts.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  미확인 경고가 없습니다.
                </div>
              ) : (
                alerts.map(renderRow)
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="residual">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">위험구역 내 미이탈 인원 (오늘 이벤트 기준)</CardTitle>
              <p className="text-xs text-muted-foreground">
                오늘 무단 진입 이후 동일 구역 이탈(exit) 기록이 없는 인원만 표시합니다. 전체 현장 체류 인원은 입퇴장 현황·근로자 분포에서 확인하세요.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {residual.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  위험구역 내 잔류 인원이 없습니다.
                </div>
              ) : (
                residual.map(renderRow)
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="all">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base">구역 이벤트 이력 ({events.length}건)</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Select
                  value={rangePreset}
                  onValueChange={(v) => setRangePreset(v as ZoneLogRangePreset)}
                >
                  <SelectTrigger className="w-32 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RANGE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={typeFilter}
                  onValueChange={(v) => setTypeFilter(v as ZoneEventTypeFilter)}
                >
                  <SelectTrigger className="w-36 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {events.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  선택한 기간·유형에 해당하는 이벤트가 없습니다.
                </div>
              ) : (
                events.map(renderRow)
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
