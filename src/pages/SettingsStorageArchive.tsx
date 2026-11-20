import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HardDrive, Loader2, ShieldOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

type PolicyStatus = {
  director_armed?: boolean;
  auto_purge_allowed?: boolean;
  purge_would_run?: boolean;
  copy_min_age_days?: number;
  purge_min_age_days?: number;
  canary_max_purge_per_tick?: number;
  normal_max_purge_per_tick?: number;
  consecutive_canary_success_nights?: number;
  backlog_over_purge_age?: number;
  last_verified_restore_at?: string | null;
  last_gate_notes?: string | null;
  last_disarm_reason?: string | null;
  armed_at?: string | null;
};

function formatWhen(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

const SettingsStorageArchive = () => {
  const { hasRole } = useAuth();
  const isMaster = hasRole("master");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<PolicyStatus | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_storage_purge_policy_status" as any);
    if (error) throw error;
    setStatus((data || {}) as PolicyStatus);
  }, []);

  useEffect(() => {
    if (!isMaster) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        await load();
      } catch (err: any) {
        toast.error(err?.message || "보관 정책 상태를 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    })();
  }, [isMaster, load]);

  if (!isMaster) return <Navigate to="/settings" replace />;

  const arm = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("arm_storage_purge_policy" as any);
      if (error) throw error;
      await load();
      toast.success("삭제 정책을 무장했습니다. 게이트가 맞으면 심야에 자동으로 삭제됩니다.");
    } catch (err: any) {
      toast.error(err?.message || "무장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const disarm = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("disarm_storage_purge_policy" as any, {
        _reason: "manual_ui",
      });
      if (error) throw error;
      await load();
      toast.message("삭제 무장을 해제했습니다. 복사는 계속됩니다.");
    } catch (err: any) {
      toast.error(err?.message || "해제에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container max-w-2xl py-6 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <HardDrive className="h-5 w-5" />
            Google One 보관 · 삭제 정책
          </CardTitle>
          <CardDescription>
            한 번만 무장하면, 60일 백로그·3밤 무오류·복원 헬스·쿼터 게이트가 맞을 때 심야에 자동 삭제합니다.
            매번 “삭제 켜줘”를 말할 필요가 없습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              불러오는 중…
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant={status?.director_armed ? "default" : "secondary"}>
                  무장 {status?.director_armed ? "ON" : "OFF"}
                </Badge>
                <Badge variant={status?.auto_purge_allowed ? "default" : "outline"}>
                  게이트 {status?.auto_purge_allowed ? "통과" : "대기"}
                </Badge>
                <Badge variant={status?.purge_would_run ? "destructive" : "outline"}>
                  오늘 밤 삭제 {status?.purge_would_run ? "예정" : "안 함"}
                </Badge>
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">60일+ 미백업 잔여</dt>
                  <dd className="font-medium">{status?.backlog_over_purge_age ?? "—"}건</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">카나리 성공 밤</dt>
                  <dd className="font-medium">
                    {status?.consecutive_canary_success_nights ?? 0} / 2 → 틱당{" "}
                    {(status?.consecutive_canary_success_nights ?? 0) >= 2
                      ? status?.normal_max_purge_per_tick ?? 15
                      : status?.canary_max_purge_per_tick ?? 5}
                    건
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">복사 / 삭제 일수</dt>
                  <dd className="font-medium">
                    {status?.copy_min_age_days ?? 30}일 / {status?.purge_min_age_days ?? 60}일
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">자체 복원 검증</dt>
                  <dd className="font-medium">{formatWhen(status?.last_verified_restore_at)}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">게이트 메모</dt>
                  <dd className="font-mono text-xs break-all">{status?.last_gate_notes || "—"}</dd>
                </div>
                {status?.last_disarm_reason && (
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">마지막 해제 사유</dt>
                    <dd className="text-xs">{status.last_disarm_reason}</dd>
                  </div>
                )}
              </dl>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button onClick={() => void arm()} disabled={busy || status?.director_armed}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  <span className="ml-2">삭제 정책 무장 (한 번)</span>
                </Button>
                <Button variant="outline" onClick={() => void disarm()} disabled={busy || !status?.director_armed}>
                  <ShieldOff className="h-4 w-4" />
                  <span className="ml-2">즉시 해제</span>
                </Button>
                <Button variant="ghost" onClick={() => void load()} disabled={busy}>
                  새로고침
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                초기값은 무장 OFF입니다. 치명 오류(OAuth·체크섬·복원 실패) 시 자동으로 무장이 내려가고, 일시
                오류는 게이트만 멈춥니다.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsStorageArchive;
