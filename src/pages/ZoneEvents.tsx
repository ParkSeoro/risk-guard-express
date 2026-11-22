import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ShieldAlert, LogIn, LogOut, Check, AlertTriangle, RefreshCw, CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useGlobalProjectAccessOptional } from "@/components/AppLayout";
import { canViewWorkerDistribution } from "@/hooks/useDistributionAccess";
import { useActiveProject } from "@/hooks/useActiveProject";
import LocationControlBar from "@/components/geofence/LocationControlBar";
import { seoulDayRange, todaySeoulDate } from "@/lib/dailyWorkAck";
import type { RestrictedZoneGeom } from "@/lib/tracking/restrictedZoneGeom";
import {
  classifyZoneEventLivePresence,
  computeActiveDangerResiduals,
  computeLogRangeSinceIso,
  resolveInitialZoneEventsTab,
  resolveZoneEventName,
  ZONE_ACK_QUICK_NOTES,
  type ZoneEventLivePosition,
  type ZoneEventRecord,
  type ZoneEventTypeFilter,
  type ZoneLogRangePreset,
} from "@/lib/zoneEventsQuery";

const EVENT_SELECT =
  "id, project_id, zone_id, restricted_zone_id, worker_qr_id, worker_name, worker_phone, event_type, source, notes, ack_note, acknowledged, acknowledged_by, acknowledged_at, created_at, restricted_zone:restricted_zones(name, zone_category, zone_color), zone:site_zones(name, zone_type, color)";

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

const PRESENCE_BADGE_CLS = {
  danger: "border-destructive/50 bg-destructive/10 text-destructive",
  safe: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
} as const;

export default function ZoneEvents() {
  const { user, hasRole } = useAuth();
  const access = useGlobalProjectAccessOptional();
  const isMaster = hasRole("master") || !!access?.isMaster;
  const projectRoleLoading = !!access?.loading;
  const canView = canViewWorkerDistribution(access?.userRole, isMaster);
  const [searchParams, setSearchParams] = useSearchParams();
  const { projectId, setProjectId } = useActiveProject();
  const appliedParamProjectRef = useRef<string | null>(null);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [alerts, setAlerts] = useState<ZoneEventRecord[]>([]);
  const [residual, setResidual] = useState<ZoneEventRecord[]>([]);
  const [events, setEvents] = useState<ZoneEventRecord[]>([]);
  const [zoneGeomById, setZoneGeomById] = useState<Record<string, RestrictedZoneGeom>>({});
  const [livePosByWorkerId, setLivePosByWorkerId] = useState<Record<string, ZoneEventLivePosition>>({});
  const [ackerNames, setAckerNames] = useState<Record<string, string>>({});
  const [ackTargetId, setAckTargetId] = useState<string | null>(null);
  const [ackNoteDraft, setAckNoteDraft] = useState("");
  const [ackSaving, setAckSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"alerts" | "residual" | "all">(() =>
    resolveInitialZoneEventsTab(searchParams),
  );
  const [rangePreset, setRangePreset] = useState<ZoneLogRangePreset>("7d");
  const [typeFilter, setTypeFilter] = useState<ZoneEventTypeFilter>("all");

  // Apply push deep link (?project=<uuid>) once per URL param value; never snap back manual Select changes
  const paramProject = searchParams.get("project");
  useEffect(() => {
    if (!paramProject) {
      appliedParamProjectRef.current = null;
      return;
    }
    if (appliedParamProjectRef.current === paramProject) return;
    appliedParamProjectRef.current = paramProject;
    setProjectId(paramProject);
  }, [paramProject, setProjectId]);

  const handleSelectProject = (nextId: string) => {
    setProjectId(nextId);
    setAckTargetId(null);
    setAckNoteDraft("");
    if (searchParams.has("project")) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("project");
      setSearchParams(nextParams, { replace: true });
    }
  };

  useEffect(() => {
    supabase
      .from("projects")
      .select("id,name")
      .eq("is_deleted", false)
      .then(({ data }) => setProjects(data || []));
  }, []);

  const load = useCallback(async () => {
    if (!projectId || projectRoleLoading || !canView) return;
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

      // 4) Active restricted zones geometry for live presence cross-check
      const zonesP = supabase
        .from("restricted_zones")
        .select("id, name, geometry_type, geo_polygon, center_lat, center_lng, radius_m, zone_category, is_active")
        .eq("project_id", projectId)
        .eq("is_deleted", false);

      const [alertsRes, todayRes, allRes, zonesRes] = await Promise.all([
        alertsP,
        todayP,
        allP,
        zonesP,
      ]);
      if (alertsRes.error) toast.error(alertsRes.error.message);
      if (todayRes.error) toast.error(todayRes.error.message);
      if (allRes.error) toast.error(allRes.error.message);

      const nextAlerts = (alertsRes.data || []) as unknown as ZoneEventRecord[];
      const nextResidual = computeActiveDangerResiduals(
        (todayRes.data || []) as unknown as ZoneEventRecord[],
      );
      const nextEvents = (allRes.data || []) as unknown as ZoneEventRecord[];

      setAlerts(nextAlerts);
      setResidual(nextResidual);
      setEvents(nextEvents);

      const zMap: Record<string, RestrictedZoneGeom> = {};
      for (const z of ((zonesRes.data || []) as unknown as RestrictedZoneGeom[])) {
        if (z?.id) zMap[z.id] = z;
      }
      setZoneGeomById(zMap);

      // Secondary non-blocking enrichment: latest positions for active alerts/residuals + acker names
      const liveWorkerIds = [
        ...new Set(
          [...nextAlerts, ...nextResidual]
            .map((e) => e.worker_qr_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const ackerIds = [
        ...new Set(
          [...nextAlerts, ...nextResidual, ...nextEvents]
            .map((e) => e.acknowledged_by)
            .filter((id): id is string => Boolean(id)),
        ),
      ];

      const [posRes, profRes] = await Promise.all([
        liveWorkerIds.length
          ? supabase
              .from("worker_last_positions")
              .select("worker_id, lat, lng, updated_at")
              .eq("project_id", projectId)
              .in("worker_id", liveWorkerIds)
          : Promise.resolve({ data: null, error: null }),
        ackerIds.length
          ? supabase
              .from("profiles")
              .select("user_id, display_name")
              .in("user_id", ackerIds)
          : Promise.resolve({ data: null, error: null }),
      ]);

      const posMap: Record<string, ZoneEventLivePosition> = {};
      for (const p of ((posRes.data || []) as unknown as ZoneEventLivePosition[])) {
        if (p?.worker_id) posMap[p.worker_id] = p;
      }
      setLivePosByWorkerId(posMap);

      const nameMap: Record<string, string> = {};
      for (const pr of (profRes.data || []) as Array<{ user_id: string; display_name: string | null }>) {
        if (pr?.user_id && pr.display_name) nameMap[pr.user_id] = pr.display_name;
      }
      setAckerNames(nameMap);
    } finally {
      setLoading(false);
    }
  }, [projectId, rangePreset, typeFilter, projectRoleLoading, canView]);

  useEffect(() => {
    if (!projectId || projectRoleLoading || !canView) return;
    void load();
    const ch = supabase
      .channel(`wze:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
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
  }, [projectId, projectRoleLoading, canView, load]);

  const submitAck = async (id: string, note: string) => {
    setAckSaving(true);
    try {
      const cleanedNote = note.trim() || null;
      const { data, error } = await supabase
        .from("worker_zone_events")
        .update({
          acknowledged: true,
          acknowledged_by: user?.id ?? null,
          acknowledged_at: new Date().toISOString(),
          ack_note: cleanedNote,
        } as any)
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
      toast.success(cleanedNote ? "확인 및 조치 메모가 기록되었습니다." : "확인 처리되었습니다.");
      setAckTargetId(null);
      setAckNoteDraft("");
      void load();
    } finally {
      setAckSaving(false);
    }
  };

  const renderRow = (e: ZoneEventRecord, showLivePresence: boolean) => {
    const cfg = EVENT_BADGE[e.event_type] || EVENT_BADGE.entry;
    const Icon = cfg.icon;
    const zoneName = resolveZoneEventName(e);
    const presence =
      showLivePresence && e.worker_qr_id && e.restricted_zone_id
        ? classifyZoneEventLivePresence(
            e,
            livePosByWorkerId[e.worker_qr_id],
            zoneGeomById[e.restricted_zone_id],
          )
        : null;
    const isAckEditing = ackTargetId === e.id;
    const ackerLabel = e.acknowledged_by ? ackerNames[e.acknowledged_by] : null;

    return (
      <div key={e.id} className="p-3 border-b last:border-b-0 text-sm space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <div className="font-medium flex items-center gap-1.5 flex-wrap">
              <span>{e.worker_name || "(이름없음)"}</span>
              {e.worker_phone && (
                <span className="text-xs font-normal text-muted-foreground">· {e.worker_phone}</span>
              )}
              {presence && (
                <Badge variant="outline" className={`text-[11px] ${PRESENCE_BADGE_CLS[presence.tone]}`}>
                  {presence.label}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {zoneName} · {new Date(e.created_at).toLocaleString("ko-KR")}
            </div>
            {e.acknowledged && (
              <div className="mt-1 flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <span>
                  확인됨{ackerLabel ? ` · ${ackerLabel}` : ""}
                  {e.acknowledged_at
                    ? ` · ${new Date(e.acknowledged_at).toLocaleString("ko-KR")}`
                    : ""}
                </span>
                {e.ack_note && (
                  <Badge variant="secondary" className="text-[11px] font-normal">
                    조치: {e.ack_note}
                  </Badge>
                )}
              </div>
            )}
          </div>
          <Badge className={cfg.color} variant="outline">
            {cfg.label}
          </Badge>
          {e.event_type === "unauthorized_entry" && !e.acknowledged && !isAckEditing && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setAckTargetId(e.id);
                setAckNoteDraft("");
              }}
            >
              <Check className="h-3 w-3 mr-1" /> 확인
            </Button>
          )}
        </div>

        {isAckEditing && (
          <div className="ml-8 rounded-md border bg-muted/40 p-2.5 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground mr-1">빠른 조치 메모:</span>
              {ZONE_ACK_QUICK_NOTES.map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  size="sm"
                  variant={ackNoteDraft === preset ? "default" : "outline"}
                  className="h-6 px-2 text-[11px]"
                  onClick={() => setAckNoteDraft(preset)}
                  disabled={ackSaving}
                >
                  {preset}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                value={ackNoteDraft}
                onChange={(ev) => setAckNoteDraft(ev.target.value)}
                placeholder="조치 메모 (선택 · 예: 현장 연락 후 이탈 확인)"
                maxLength={500}
                className="h-8 text-xs flex-1 min-w-[200px] bg-background"
                disabled={ackSaving}
              />
              <Button
                size="sm"
                className="h-8 text-xs"
                onClick={() => void submitAck(e.id, ackNoteDraft)}
                disabled={ackSaving}
              >
                <Check className="h-3.5 w-3.5 mr-1" />
                {ackSaving ? "저장 중…" : "확인 완료"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs"
                onClick={() => {
                  setAckTargetId(null);
                  setAckNoteDraft("");
                }}
                disabled={ackSaving}
              >
                <X className="h-3.5 w-3.5 mr-1" /> 취소
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!projectRoleLoading && !canView) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto text-sm text-muted-foreground">
        구역 출입 모니터링은 선택한 현장의 관리자(마스터·프로젝트관리자·안전관리자·현장소장·감리·관리감독자)만 볼 수 있습니다.
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">구역 출입 모니터링</h1>
        </div>
        <div className="flex items-center gap-2">
          <Select value={projectId} onValueChange={handleSelectProject}>
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

      <LocationControlBar
        projectId={projectId}
        activeTab="zone-events"
        refreshKey={`${alerts.length}:${events.length}`}
      />

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
                alerts.map((e) => renderRow(e, true))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="residual">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">위험구역 내 미이탈 인원 (오늘 이벤트 기준)</CardTitle>
              <p className="text-xs text-muted-foreground">
                오늘 마지막 구역 이벤트가 무단 진입(이탈·일반구역 이동 없음)인 인원만 표시하며, 최근 GPS 좌표로 현재 체류·이탈 상태를 함께 교차 표시합니다.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {residual.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  위험구역 내 잔류 인원이 없습니다.
                </div>
              ) : (
                residual.map((e) => renderRow(e, true))
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
                events.map((e) => renderRow(e, false))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
