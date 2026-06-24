import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, Play, Square, ShieldCheck, History } from "lucide-react";
import { toast } from "sonner";
import {
  startTracking,
  hasTrackingConsent,
  setTrackingConsent,
  type TrackingIdentity,
} from "@/lib/tracking/locationTracker";

type MyLog = { id: string; zone_id: string | null; event_type: string; source: string | null; created_at: string };

export default function WorkerTrackingCard({ identity }: { identity: TrackingIdentity }) {
  const [consented, setConsented] = useState<boolean>(hasTrackingConsent());
  const [running, setRunning] = useState(false);
  const [info, setInfo] = useState<{ acc: number; zone: string | null; source: string } | null>(null);
  const [logs, setLogs] = useState<MyLog[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const stopRef = useRef<null | (() => void)>(null);

  const loadLogs = async () => {
    if (!identity.worker_phone) return;
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from("worker_zone_events")
      .select("id, zone_id, event_type, source, created_at")
      .eq("project_id", identity.project_id)
      .eq("worker_phone", identity.worker_phone)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(50);
    setLogs((data || []) as MyLog[]);
  };
  useEffect(() => { if (showLogs) loadLogs(); }, [showLogs]);

  useEffect(() => () => stopRef.current?.(), []);

  const start = async () => {
    try {
      const stop = await startTracking({
        identity,
        onUpdate: (u) =>
          setInfo({ acc: Math.round(u.accuracy), zone: u.zone_id, source: u.source }),
        onError: (e) => toast.error("위치 추적 오류: " + e.message),
      });
      stopRef.current = stop;
      setRunning(true);
      toast.success("위치 추적이 시작되었습니다");
    } catch (e: any) {
      toast.error(e?.message || "추적을 시작할 수 없습니다");
    }
  };

  const stop = () => {
    stopRef.current?.();
    stopRef.current = null;
    setRunning(false);
    setInfo(null);
  };

  const accept = () => {
    setTrackingConsent(true);
    setConsented(true);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" /> 현장 위치 자동 기록
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!consented ? (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground leading-relaxed">
              안전 관리를 위해 작업 중 위치를 GPS로 자동 기록합니다.
              위험·제한구역 무단진입 시 자동 경보가 발송되며,
              위치 기록은 <b>90일</b> 후 자동으로 익명화됩니다. 언제든 중단할 수 있습니다.
            </p>
            <Button size="sm" onClick={accept}>
              <ShieldCheck className="h-4 w-4 mr-1" /> 동의하고 사용
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              {!running ? (
                <Button size="sm" onClick={start}>
                  <Play className="h-4 w-4 mr-1" /> 추적 시작
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={stop}>
                  <Square className="h-4 w-4 mr-1" /> 추적 중지
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTrackingConsent(false);
                  stop();
                  setConsented(false);
                }}
              >
                동의 철회
              </Button>
            </div>
            {info && (
              <div className="text-xs text-muted-foreground flex flex-wrap gap-2 items-center">
                <Badge variant="outline">정확도 ±{info.acc}m</Badge>
                <Badge variant="outline">소스: {info.source}</Badge>
                <Badge variant={info.zone ? "default" : "secondary"}>
                  {info.zone ? "구역 내" : "구역 외"}
                </Badge>
              </div>
            )}
            {!info && running && (
              <div className="text-xs text-muted-foreground">위치 신호 수신 중…</div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
