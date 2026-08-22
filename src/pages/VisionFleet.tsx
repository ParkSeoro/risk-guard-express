import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useGlobalProjectAccess } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Video, Radio, CheckCircle2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";

type Gateway = {
  id: string;
  external_id: string;
  device_name: string | null;
  enroll_status: string;
  last_seen_at: string | null;
  connection_state: string | null;
};
type EventRow = {
  id: string;
  event_id: string;
  camera_id: string | null;
  rule_outcome: string | null;
  severity: string;
  occurred_at: string;
  review_status: string;
  review_note: string | null;
};
type Camera = { id: string; camera_id: string; name: string; health_state: string | null; gateway_id: string };

export default function VisionFleet() {
  const access = useGlobalProjectAccess();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const projectId = access.selectedProject;
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [kitBlob, setKitBlob] = useState<string | null>(null);
  const [selectedGw, setSelectedGw] = useState<string | null>(null);

  const load = async () => {
    if (!projectId) {
      setGateways([]);
      setEvents([]);
      setCameras([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [g, e, c] = await Promise.all([
      supabase.from("vision_gateways" as any).select("id, external_id, device_name, enroll_status, last_seen_at, connection_state").eq("project_id", projectId).order("last_seen_at", { ascending: false }),
      supabase.from("vision_safety_events" as any).select("id, event_id, camera_id, rule_outcome, severity, occurred_at, review_status, review_note").eq("project_id", projectId).order("occurred_at", { ascending: false }).limit(50),
      supabase.from("vision_cameras" as any).select("id, camera_id, name, health_state, gateway_id").eq("project_id", projectId),
    ]);
    setGateways((g.data || []) as Gateway[]);
    setEvents((e.data || []) as EventRow[]);
    setCameras((c.data || []) as Camera[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  const ack = async (row: EventRow) => {
    const { error } = await supabase
      .from("vision_safety_events" as any)
      .update({
        review_status: "acked",
        review_note: note || "확인",
        reviewed_by: user?.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (error) toast.error(error.message);
    else {
      toast.success("확인 처리되었습니다");
      void load();
    }
  };

  const fleetPost = async (path: string, body: unknown) => {
    const session = await supabase.auth.getSession();
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vision-fleet${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.data.session?.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j as { error?: string }).error || res.statusText);
    return j;
  };

  const requestGrant = async (cam: Camera) => {
    try {
      await fleetPost("/v1/stream-grants", { camera_row_id: cam.id, action: "live_substream" });
      toast.success("5분 보기 권한이 발급되었습니다. 중계는 Gateway가 outbound로만 연결합니다.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "grant 실패");
    }
  };

  const issueKit = async () => {
    if (!projectId) return;
    try {
      const j = (await fleetPost("/v1/provisioning-kits", { project_id: projectId })) as { kit?: string };
      setKitBlob(j.kit || null);
      toast.success("1회용 설치 키트가 발급되었습니다. Gateway 로컬 콘솔에만 붙여넣으세요.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "키트 발급 실패");
    }
  };

  const fleetUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vision-fleet`;
  const focusEvent = params.get("event");

  return (
    <div className="p-6 space-y-4 max-w-5xl mx-auto" data-testid="vision-fleet">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Video className="h-5 w-5" /> 비전 관제
        </h1>
        <p className="text-xs text-muted-foreground">
          파일럿 · NVR 원본은 현장에 남습니다. 실시간 모자이크가 아니라 상태·이벤트 큐입니다.
        </p>
        {projectId && (
          <Button size="sm" variant="outline" className="mt-2 h-8 text-xs" onClick={() => void issueKit()}>
            설치 키트 발급
          </Button>
        )}
        {kitBlob && (
          <p className="mt-2 text-[11px] break-all font-mono bg-muted p-2 rounded">{kitBlob}</p>
        )}
        {projectId && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            현장 QR용 Fleet 주소
            <span className="ml-1 font-mono break-all">{fleetUrl}</span>
          </p>
        )}
      </div>

      {!projectId && <p className="text-sm text-muted-foreground">프로젝트를 선택하세요.</p>}
      {loading && <p className="text-sm text-muted-foreground">불러오는 중…</p>}

      <div className="grid md:grid-cols-2 gap-3">
        {gateways.map((g) => (
          <Card
            key={g.id}
            className={selectedGw === g.id ? "border-primary" : "cursor-pointer"}
            onClick={() => setSelectedGw(g.id)}
          >
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Radio className="h-4 w-4" />
                {g.device_name || g.external_id}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-1">
              <Badge variant="secondary">{g.enroll_status}</Badge>
              <span className="ml-2">{g.connection_state || "unknown"}</span>
              <p className="text-muted-foreground">
                {g.last_seen_at
                  ? formatDistanceToNow(new Date(g.last_seen_at), { addSuffix: true, locale: ko })
                  : "신호 없음"}
              </p>
              {selectedGw === g.id && (
                <p className="text-muted-foreground break-all">id {g.external_id}</p>
              )}
            </CardContent>
          </Card>
        ))}
        {!loading && projectId && gateways.length === 0 && (
          <p className="text-sm text-muted-foreground col-span-2">등록된 Gateway가 없습니다. 현장 설치 후 QR/Kit으로 페어링하세요.</p>
        )}
      </div>

      {cameras.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">카메라 health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {cameras
              .filter((c) => !selectedGw || c.gateway_id === selectedGw)
              .map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm border-b py-1.5">
                <span>
                  {c.name} <span className="text-muted-foreground text-xs">{c.health_state || "unknown"}</span>
                </span>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void requestGrant(c)}>
                  보기 권한
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">안전 이벤트</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="확인 메모" className="text-sm" rows={2} />
          {events.length === 0 && <p className="text-sm text-muted-foreground">이벤트가 없습니다.</p>}
          {events.map((ev) => (
            <div
              key={ev.id}
              className={`rounded-lg border p-3 text-sm space-y-1 ${focusEvent === ev.event_id ? "border-amber-500" : ""}`}
            >
              <div className="flex items-center gap-2">
                <Badge variant={ev.review_status === "open" ? "default" : "secondary"}>{ev.review_status}</Badge>
                <span className="font-medium">{ev.rule_outcome || ev.severity}</span>
                <span className="text-xs text-muted-foreground">{ev.camera_id || "-"}</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {formatDistanceToNow(new Date(ev.occurred_at), { addSuffix: true, locale: ko })}
              </p>
              {ev.review_status === "open" && (
                <Button size="sm" className="h-8" onClick={() => void ack(ev)}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> 확인
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
