import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Headset, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import {
  acceptRemoteSupportSession,
  endRemoteSupportSession,
  fetchRemoteSupportSession,
  rejectRemoteSupportSession,
  type RemoteSupportSession,
} from "@/lib/remoteSupport";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const RemoteSupportPage = () => {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const sessionId = params.get("session");
  const [session, setSession] = useState<RemoteSupportSession | null>(null);
  const [requesterName, setRequesterName] = useState("현장 사용자");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!sessionId) {
      setSession(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const row = await fetchRemoteSupportSession(sessionId);
      setSession(row);
      if (row) {
        const { data } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("user_id", row.requester_id)
          .maybeSingle();
        setRequesterName(data?.display_name || "현장 사용자");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "세션을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [sessionId]);

  if (!sessionId) {
    return (
      <div className="max-w-lg space-y-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Headset className="h-5 w-5" /> 원격지원
        </h1>
        <p className="text-sm text-muted-foreground">알림에서 세션을 선택하거나 대기 중인 요청을 확인하세요.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-10">
        <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
      </div>
    );
  }

  if (!session) {
    return <p className="text-sm text-muted-foreground">세션을 찾을 수 없습니다.</p>;
  }

  const isAgent = user?.id === session.agent_id;
  const isRequester = user?.id === session.requester_id;

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-xl font-bold flex items-center gap-2">
        <Headset className="h-5 w-5" /> 원격지원
      </h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">세션 상태: {session.status}</CardTitle>
          <CardDescription>
            요청자: {requesterName}
            {session.requester_path ? ` · ${session.requester_path}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {isAgent && session.status === "pending" && (
            <>
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const next = await acceptRemoteSupportSession(session.id);
                    setSession(next);
                    toast.success("수락했습니다. 요청자 화면공유를 기다립니다.");
                  } catch (err: unknown) {
                    toast.error(err instanceof Error ? err.message : "수락 실패");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                수락
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const next = await rejectRemoteSupportSession(session.id);
                    setSession(next);
                  } catch (err: unknown) {
                    toast.error(err instanceof Error ? err.message : "거절 실패");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                거절
              </Button>
            </>
          )}
          {(isAgent || isRequester) && (session.status === "pending" || session.status === "active") && (
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const next = await endRemoteSupportSession(session.id);
                  setSession(next);
                  toast.message("세션을 종료했습니다.");
                } catch (err: unknown) {
                  toast.error(err instanceof Error ? err.message : "종료 실패");
                } finally {
                  setBusy(false);
                }
              }}
            >
              종료
            </Button>
          )}
          <Button variant="ghost" onClick={() => navigate("/app/admin/")}>
            대시보드
          </Button>
        </CardContent>
      </Card>
      {session.status === "active" && isAgent && (
        <p className="text-sm text-muted-foreground">
          지원 콘솔이 자동으로 열립니다. 요청자가 화면공유를 허용하면 영상이 표시됩니다.
        </p>
      )}
    </div>
  );
};

export default RemoteSupportPage;
