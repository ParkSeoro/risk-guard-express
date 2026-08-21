import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import MobilePageHeader from "@/components/mobile/MobilePageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";

type EventRow = {
  id: string;
  event_id: string;
  camera_id: string | null;
  rule_outcome: string | null;
  severity: string;
  occurred_at: string;
  review_status: string;
};

export default function MobileVisionEvents() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const { projectId } = useMobileAccess();
  const [events, setEvents] = useState<EventRow[]>([]);
  const focus = params.get("event");

  const load = async () => {
    if (!projectId) {
      setEvents([]);
      return;
    }
    const { data, error } = await supabase
      .from("vision_safety_events" as any)
      .select("id, event_id, camera_id, rule_outcome, severity, occurred_at, review_status")
      .eq("project_id", projectId)
      .order("occurred_at", { ascending: false })
      .limit(40);
    if (error) toast.error(error.message);
    setEvents((data || []) as EventRow[]);
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  const ack = async (row: EventRow) => {
    const { error } = await supabase
      .from("vision_safety_events" as any)
      .update({
        review_status: "acked",
        review_note: "모바일 확인",
        reviewed_by: user?.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (error) toast.error(error.message);
    else {
      toast.success("확인했습니다");
      void load();
    }
  };

  return (
    <div className="max-w-md mx-auto" data-testid="mobile-vision-events">
      <MobilePageHeader title="비전 이벤트" onBack={() => navigate("/app/worker/today")} />
      <main className="px-4 pb-8 space-y-3">
        <p className="text-xs text-muted-foreground">실시간 영상이 아니라 현장 Gateway가 올린 안전 이벤트입니다.</p>
        {events.map((ev) => (
          <Card key={ev.id} className={focus === ev.event_id ? "border-amber-500" : ""}>
            <CardContent className="p-3 space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant={ev.review_status === "open" ? "default" : "secondary"}>{ev.review_status}</Badge>
                <span className="font-medium">{ev.rule_outcome || ev.severity}</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {ev.camera_id || "-"} ·{" "}
                {formatDistanceToNow(new Date(ev.occurred_at), { addSuffix: true, locale: ko })}
              </p>
              {ev.review_status === "open" && (
                <Button size="sm" className="h-8" onClick={() => void ack(ev)}>
                  확인
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
        {events.length === 0 && <p className="text-sm text-muted-foreground">이벤트가 없습니다.</p>}
      </main>
    </div>
  );
}
