import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useGlobalProjectAccess } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Video, Radio, CheckCircle2, Camera, WifiOff } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";
import {
  visionCameraSlots,
  visionCanOperate,
  visionRoleLabel,
} from "@/lib/visionFleetApi";

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
type CameraRow = { id: string; camera_id: string; name: string; health_state: string | null; gateway_id: string };

export default function VisionFleet() {
  const access = useGlobalProjectAccess();
  const { user, roles } = useAuth();
  const [params] = useSearchParams();
  const projectId = access.selectedProject;
  const canOperate = visionCanOperate(roles);
  const roleLabel = visionRoleLabel(roles);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [cameras, setCameras] = useState<CameraRow[]>([]);
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
    if (g.error || e.error || c.error) {
      toast.error(g.error?.message || e.error?.message || c.error?.message || "관제 데이터를 불러오지 못했습니다");
    }
    setGateways((g.data || []) as Gateway[]);
    setEvents((e.data || []) as EventRow[]);
    setCameras((c.data || []) as CameraRow[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  const ack = async (row: EventRow) => {
    if (!canOperate) {
      toast.error("이벤트 확인 권한이 없습니다");
      return;
    }
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

  const requestGrant = async (cam: CameraRow) => {
    if (!canOperate) {
      toast.error("보기 권한 발급은 관제 담당자만 할 수 있습니다");
      return;
    }
    try {
      await fleetPost("/v1/stream-grants", { camera_row_id: cam.id, action: "live_substream" });
      toast.success("5분 보기 권한이 발급되었습니다. 중계는 Gateway가 outbound로만 연결합니다.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "grant 실패");
    }
  };

  const issueKit = async () => {
    if (!projectId || !canOperate) return;
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
  const visibleCams = cameras.filter((c) => !selectedGw || c.gateway_id === selectedGw);
  const extraCams = visibleCams.slice(4);
  const slots = visionCameraSlots(visibleCams);
  const onlineCams = cameras.filter((c) => c.health_state === "online").length;
  const openEvents = events.filter((ev) => ev.review_status === "open").length;
  const onlineGw = gateways.filter((g) => g.connection_state === "online").length;

  return (
    <div className="p-6 space-y-4 max-w-5xl mx-auto" data-testid="vision-fleet">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Video className="h-5 w-5" /> 비전 관제
          </h1>
          <p className="text-xs text-muted-foreground">
            파일럿 · NVR 원본은 현장에 남습니다. CCTV가 없어도 상태·슬롯·이벤트 큐는 항상 표시됩니다.
          </p>
        </div>
        <Badge variant="secondary">{roleLabel}{canOperate ? " · 운영" : " · 조회"}</Badge>
      </div>

      {!projectId && (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">프로젝트를 선택하면 이 현장의 관제 보드가 열립니다.</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Gateway" value={loading ? "…" : String(gateways.length)} hint={onlineGw ? `${onlineGw}대 온라인` : "미연결"} />
        <Stat label="카메라" value={loading ? "…" : String(cameras.length)} hint={cameras.length ? `${onlineCams}대 온라인` : "슬롯 대기"} />
        <Stat label="열린 이벤트" value={loading ? "…" : String(openEvents)} hint="사이렌 없음" />
        <Stat label="연결 상태" value={gateways.length === 0 ? "대기" : onlineGw > 0 ? "수신" : "오프라인"} hint="현장 Gateway 기준" />
      </div>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Camera className="h-4 w-4" /> 카메라 보드
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-[11px] text-muted-foreground mb-3">
            웹에는 실시간 모자이크가 없습니다. 연결 전에도 4슬롯을 보여 주고, 연결된 카메라만 health를 채웁니다.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {slots.map((cam, idx) => (
              <div
                key={cam?.id || `slot-${idx}`}
                className="rounded-md border bg-muted/30 min-h-[112px] p-3 flex flex-col justify-between"
              >
                {cam ? (
                  <>
                    <div>
                      <p className="text-sm font-medium">{cam.name}</p>
                      <p className="text-[11px] text-muted-foreground">{cam.camera_id}</p>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant={cam.health_state === "online" ? "default" : "secondary"}>
                        {cam.health_state || "unknown"}
                      </Badge>
                      {canOperate && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void requestGrant(cam)}>
                          보기 권한
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <p className="text-sm font-medium">카메라 {idx + 1}</p>
                      <p className="text-[11px] text-muted-foreground">미연결 · 현장 Gateway 대기</p>
                    </div>
                    <WifiOff className="h-4 w-4 text-muted-foreground" />
                  </>
                )}
              </div>
            ))}
          </div>
          {extraCams.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {extraCams.map((c) => (
                <li key={c.id} className="flex items-center justify-between border-t pt-1.5">
                  <span>{c.name} <span className="text-xs text-muted-foreground">{c.health_state || "unknown"}</span></span>
                  {canOperate && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void requestGrant(c)}>
                      보기 권한
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Radio className="h-4 w-4" /> 현장 Gateway
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {gateways.length === 0 && (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              등록된 Gateway가 없습니다. 현장 PC에 Vision Edge를 설치한 뒤 QR 또는 설치 키트로 이 프로젝트에 연결하세요.
              연결 전에도 위 카메라 슬롯과 아래 이벤트 큐는 그대로 둡니다.
            </div>
          )}
          <div className="grid md:grid-cols-2 gap-3">
            {gateways.map((g) => (
              <button
                type="button"
                key={g.id}
                className={`text-left rounded-md border p-3 text-xs space-y-1 ${selectedGw === g.id ? "border-primary" : ""}`}
                onClick={() => setSelectedGw((cur) => (cur === g.id ? null : g.id))}
              >
                <p className="text-sm font-medium">{g.device_name || g.external_id}</p>
                <div>
                  <Badge variant="secondary">{g.enroll_status}</Badge>
                  <span className="ml-2">{g.connection_state || "unknown"}</span>
                </div>
                <p className="text-muted-foreground">
                  {g.last_seen_at
                    ? formatDistanceToNow(new Date(g.last_seen_at), { addSuffix: true, locale: ko })
                    : "신호 없음"}
                </p>
                {selectedGw === g.id && <p className="text-muted-foreground break-all">id {g.external_id}</p>}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {canOperate && projectId && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">현장 연결</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              QR은 현장 PC 콘솔에서 시작하고, 스마트폰 SafeNex에서 이 현장을 승인합니다. 키트는 본사 일괄 설치용입니다.
            </p>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => void issueKit()}>
              설치 키트 발급
            </Button>
            {kitBlob && <p className="text-[11px] break-all font-mono bg-muted p-2 rounded">{kitBlob}</p>}
            <p className="text-[11px] text-muted-foreground">
              현장 QR용 Fleet 주소 <span className="font-mono break-all">{fleetUrl}</span>
            </p>
          </CardContent>
        </Card>
      )}

      {!canOperate && (
        <p className="text-xs text-muted-foreground">
          조회 권한입니다. 설치 키트·보기 권한·이벤트 확인은 본사·현장소장·안전관리자·프로젝트 관리자만 할 수 있습니다.
        </p>
      )}

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">안전 이벤트</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {canOperate && (
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="확인 메모" className="text-sm" rows={2} />
          )}
          {events.length === 0 && (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              아직 올라온 이벤트가 없습니다. Gateway가 연결되면 PPE·카메라 health 이벤트가 여기 쌓입니다. 사이렌 채널은 쓰지 않습니다.
            </div>
          )}
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
              {canOperate && ev.review_status === "open" && (
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

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="py-3 px-3">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold leading-tight mt-0.5">{value}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>
      </CardContent>
    </Card>
  );
}
