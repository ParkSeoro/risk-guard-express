import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ShieldAlert, LogIn, LogOut, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useActiveProject } from "@/hooks/useActiveProject";

type Event = {
  id: string;
  project_id: string;
  zone_id: string | null;
  worker_name: string | null;
  worker_phone: string | null;
  event_type: string;
  acknowledged: boolean;
  acknowledged_at: string | null;
  created_at: string;
  zone?: { name: string; zone_type: string; color: string | null };
};

const EVENT_BADGE: Record<string, { label: string; color: string; icon: any }> = {
  entry: { label: "입장", color: "bg-primary/10 text-primary", icon: LogIn },
  exit: { label: "퇴장", color: "bg-muted text-foreground", icon: LogOut },
  unauthorized_entry: { label: "위험구역 진입", color: "bg-destructive/10 text-destructive", icon: ShieldAlert },
};

export default function ZoneEvents() {
  const { projectId, setProjectId } = useActiveProject();
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [residual, setResidual] = useState<Event[]>([]);
  const [tab, setTab] = useState("alerts");

  useEffect(() => {
    supabase.from("projects").select("id,name").eq('is_deleted', false).then(({ data }) => setProjects(data || []));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    load();
    const ch = supabase
      .channel(`wze:${projectId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "worker_zone_events", filter: `project_id=eq.${projectId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [projectId]);

  const load = async () => {
    const { data } = await supabase
      .from("worker_zone_events")
      .select("*, zone:site_zones(name, zone_type, color)")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(300);
    const list = (data || []) as any as Event[];
    setEvents(list);
    // residual: today's entries with no matching exit by name
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todays = list.filter(e => new Date(e.created_at) >= today);
    const inCount: Record<string, number> = {};
    const lastEntry: Record<string, Event> = {};
    for (const e of [...todays].reverse()) {
      const k = (e.worker_name || "") + "|" + (e.worker_phone || "");
      if (e.event_type === "entry" || e.event_type === "unauthorized_entry") {
        inCount[k] = (inCount[k] || 0) + 1;
        lastEntry[k] = e;
      } else if (e.event_type === "exit") {
        inCount[k] = (inCount[k] || 0) - 1;
      }
    }
    setResidual(Object.entries(inCount).filter(([, c]) => c > 0).map(([k]) => lastEntry[k]).filter(Boolean));
  };

  const ack = async (id: string) => {
    const { error } = await supabase
      .from("worker_zone_events")
      .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
      .eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("확인 처리");
    load();
  };

  const alerts = events.filter(e => e.event_type === "unauthorized_entry" && !e.acknowledged);

  const renderRow = (e: Event) => {
    const cfg = EVENT_BADGE[e.event_type] || EVENT_BADGE.entry;
    const Icon = cfg.icon;
    return (
      <div key={e.id} className="flex items-center gap-3 p-3 border-b text-sm">
        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="font-medium">{e.worker_name || "(이름없음)"} {e.worker_phone && <span className="text-xs text-muted-foreground">· {e.worker_phone}</span>}</div>
          <div className="text-xs text-muted-foreground">
            {e.zone?.name || "(구역 삭제됨)"} · {new Date(e.created_at).toLocaleString("ko-KR")}
          </div>
        </div>
        <Badge className={cfg.color} variant="outline">{cfg.label}</Badge>
        {e.event_type === "unauthorized_entry" && !e.acknowledged && (
          <Button size="sm" variant="outline" onClick={() => ack(e.id)}>
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
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="w-56"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
          <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="alerts">
            위험구역 경고 {alerts.length > 0 && <Badge className="ml-2 bg-destructive text-destructive-foreground">{alerts.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="residual">
            현재 잔류 {residual.length > 0 && <Badge className="ml-2">{residual.length}</Badge>}
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
                <div className="py-8 text-center text-muted-foreground text-sm">미확인 경고가 없습니다.</div>
              ) : alerts.map(renderRow)}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="residual">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">현재 현장 내 잔류 근로자 (오늘)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {residual.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">잔류 근로자 없음. 모두 퇴장 처리되었습니다.</div>
              ) : residual.map(renderRow)}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="all">
          <Card>
            <CardContent className="p-0">
              {events.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">아직 기록된 이벤트가 없습니다.</div>
              ) : events.map(renderRow)}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
