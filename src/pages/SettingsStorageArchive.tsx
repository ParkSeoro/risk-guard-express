import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  HardDrive,
  Loader2,
  ShieldOff,
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
  Clock,
  Cloud,
  Database,
  Trash2,
  Activity,
} from "lucide-react";
import { toast } from "sonner";

type PolicyStatus = {
  director_armed?: boolean;
  auto_purge_allowed?: boolean;
  purge_would_run?: boolean;
  copy_min_age_days?: number;
  purge_min_age_days?: number;
  canary_max_purge_per_tick?: number;
  normal_max_purge_per_tick?: number;
  consecutive_clean_nights?: number;
  consecutive_canary_success_nights?: number;
  backlog_over_purge_age?: number;
  backlog_over_copy_age?: number;
  last_verified_restore_at?: string | null;
  last_gate_notes?: string | null;
  last_disarm_reason?: string | null;
  armed_at?: string | null;
};

type DomainStat = {
  domain: string;
  backed_up_count: number;
  purged_count: number;
  total_bytes: number;
};

type BackupRun = {
  id: string;
  mode: string;
  started_at: string;
  finished_at: string | null;
  copied_cnt: number;
  verified_cnt: number;
  purged_cnt: number;
  skipped_cnt: number;
  error_cnt: number;
  circuit_broken: boolean;
};

type DashboardData = {
  refreshed_at?: string;
  policy?: PolicyStatus;
  storage?: {
    total_objects?: number;
    total_bytes?: number;
    over_30d_objects?: number;
    over_60d_objects?: number;
  };
  registry?: {
    backed_up_count?: number;
    backed_up_bytes?: number;
    purged_count?: number;
    purged_bytes?: number;
    failed_count?: number;
  };
  by_domain?: DomainStat[];
  quota?: {
    used_bytes?: number;
    limit_bytes?: number;
  };
  copied_24h?: number;
  recent_runs?: BackupRun[];
};

const DOMAIN_LABELS: Record<string, string> = {
  work_plan: "작업계획서",
  safety_cost: "안전관리비",
  safety_inspection: "안전점검",
  risk_assessment: "위험성평가",
  tbm: "TBM",
  accident: "사고보고",
  incident: "아차사고",
  work_stop: "작업중지",
  chemical: "화학물질(MSDS)",
  worker_sign: "근로자 서명",
  other: "기타",
};

function formatWhen(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

function formatBytesAuto(bytes?: number | null): string {
  const b = Number(bytes || 0);
  if (!Number.isFinite(b) || b <= 0) return "0 MB";
  const tb = b / (1024 ** 4);
  if (tb >= 1) return `${tb.toFixed(2)} TB`;
  const gb = b / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = b / (1024 ** 2);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.round(b / 1024)} KB`;
}

function formatDurationSec(start?: string | null, end?: string | null): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  return `${Math.round(ms / 1000)}초`;
}

const SettingsStorageArchive = () => {
  const { hasRole } = useAuth();
  const isMaster = hasRole("master");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dash, setDash] = useState<DashboardData | null>(null);

  const load = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    try {
      const { data, error } = await supabase.rpc("get_storage_archive_dashboard" as any);
      if (error) {
        // Fallback to legacy status RPC if needed
        const fallback = await supabase.rpc("get_storage_purge_policy_status" as any);
        if (fallback.error) throw fallback.error;
        setDash({
          refreshed_at: new Date().toISOString(),
          policy: (fallback.data || {}) as PolicyStatus,
        });
        return;
      }
      setDash((data || {}) as DashboardData);
    } finally {
      if (isManualRefresh) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!isMaster) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        await load(false);
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
      await load(true);
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
      await load(true);
      toast.message("삭제 무장을 해제했습니다. 복사는 계속됩니다.");
    } catch (err: any) {
      toast.error(err?.message || "해제에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const status = dash?.policy;
  const backlog60 = status?.backlog_over_purge_age ?? 0;
  const copied24h = dash?.copied_24h ?? 0;
  const estDaysToPurge =
    backlog60 <= 0
      ? 0
      : copied24h > 0
        ? Math.ceil(backlog60 / copied24h)
        : Math.ceil(backlog60 / 150);

  const quotaUsed = dash?.quota?.used_bytes ?? 0;
  const quotaLimit = dash?.quota?.limit_bytes ?? 0;
  const quotaPct = quotaLimit > 0 ? Math.min(100, Math.round((quotaUsed / quotaLimit) * 1000) / 10) : 0;

  const gateNotes = status?.last_gate_notes || "";
  const restoreOk = gateNotes.includes("restore_ok=t") || Boolean(status?.last_verified_restore_at);
  const quotaOk = gateNotes.includes("quota_ok=t") || (quotaLimit > 0 && quotaPct < 90);
  const cleanNights = status?.consecutive_clean_nights ?? 0;

  return (
    <div className="container max-w-5xl py-6 space-y-4 animate-fade-in">
      {/* Header & Controls */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <HardDrive className="h-5 w-5 text-primary" />
                Google One 보관 · 삭제 정책 대시보드
              </CardTitle>
              <CardDescription className="mt-1">
                매일 심야(02:05~03:55 KST, 12회)에 30일 이상 파일을 Google One으로 복사·검증하고,
                60일 이상 백로그가 0건이 되면 안전 게이트 통과 후 Supabase 원본을 자동 삭제합니다.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={refreshing || loading}
                onClick={() => void load(true)}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                새로고침
              </Button>
            </div>
          </div>
          {dash?.refreshed_at && (
            <p className="text-[11px] text-muted-foreground pt-1">
              마지막 조회 시각: {formatWhen(dash.refreshed_at)} (새로고침 시 실시간 재집계)
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" />
              실시간 집계 불러오는 중…
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={status?.director_armed ? "default" : "secondary"}>
                    무장 {status?.director_armed ? "ON" : "OFF"}
                  </Badge>
                  <Badge variant={status?.auto_purge_allowed ? "default" : "outline"}>
                    게이트 {status?.auto_purge_allowed ? "통과" : "대기"}
                  </Badge>
                  <Badge variant={status?.purge_would_run ? "destructive" : "outline"}>
                    오늘 밤 삭제 {status?.purge_would_run ? "예정" : "대기 중"}
                  </Badge>
                  {status?.director_armed && !status?.auto_purge_allowed && backlog60 > 0 && (
                    <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">
                      약 {estDaysToPurge}일 뒤 삭제 자동 개시 예상
                    </Badge>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void arm()} disabled={busy || status?.director_armed}>
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                    <span className="ml-1.5">삭제 정책 무장</span>
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void disarm()} disabled={busy || !status?.director_armed}>
                    <ShieldOff className="h-3.5 w-3.5" />
                    <span className="ml-1.5">즉시 해제</span>
                  </Button>
                </div>
              </div>

              {/* 4 KPI Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
                <div className="rounded-lg border p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Database className="h-3.5 w-3.5 text-primary" /> Supabase 현재 용량
                  </div>
                  <p className="text-lg font-bold">{formatBytesAuto(dash?.storage?.total_bytes)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    전체 {(dash?.storage?.total_objects ?? 0).toLocaleString()}건 · 60일+{" "}
                    {(dash?.storage?.over_60d_objects ?? 0).toLocaleString()}건
                  </p>
                </div>

                <div className="rounded-lg border p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Cloud className="h-3.5 w-3.5 text-blue-600" /> Google One 백업 완료
                  </div>
                  <p className="text-lg font-bold">
                    {(dash?.registry?.backed_up_count ?? 0).toLocaleString()}건
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatBytesAuto(dash?.registry?.backed_up_bytes)} · 최근 24시간 +{copied24h}건
                  </p>
                </div>

                <div className="rounded-lg border p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Trash2 className="h-3.5 w-3.5 text-emerald-600" /> Supabase 삭제 절감
                  </div>
                  <p className="text-lg font-bold">
                    {(dash?.registry?.purged_count ?? 0).toLocaleString()}건
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    절감 {formatBytesAuto(dash?.registry?.purged_bytes)}
                    {(dash?.registry?.failed_count ?? 0) > 0
                      ? ` · 오류 ${dash?.registry?.failed_count}건`
                      : " · 오류 0건"}
                  </p>
                </div>

                <div className="rounded-lg border p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <HardDrive className="h-3.5 w-3.5" /> Google One 용량
                    </span>
                    <span className="font-medium text-foreground">{quotaPct}%</span>
                  </div>
                  <p className="text-sm font-bold">
                    {formatBytesAuto(quotaUsed)} / {formatBytesAuto(quotaLimit)}
                  </p>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${Math.max(2, quotaPct)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* 5 Safety Gates Checklist */}
              <div className="rounded-lg border bg-muted/20 p-3 space-y-2.5">
                <p className="text-xs font-semibold">자동 삭제 5대 안전 게이트 (모두 통과 시 심야 자동 삭제 개시)</p>
                <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2 text-xs">
                  <div className="rounded-md border bg-background p-2 space-y-0.5">
                    <div className="flex items-center gap-1 font-medium">
                      {status?.director_armed ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                      1. 디렉터 무장
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {status?.director_armed ? `ON (${formatWhen(status.armed_at)})` : "OFF (수동 무장 필요)"}
                    </p>
                  </div>

                  <div className="rounded-md border bg-background p-2 space-y-0.5">
                    <div className="flex items-center gap-1 font-medium">
                      {backlog60 === 0 ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <Clock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                      )}
                      2. 60일+ 백로그
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {backlog60 === 0
                        ? "0건 (통과)"
                        : `${backlog60.toLocaleString()}건 남음 (약 ${estDaysToPurge}일 소요)`}
                    </p>
                  </div>

                  <div className="rounded-md border bg-background p-2 space-y-0.5">
                    <div className="flex items-center gap-1 font-medium">
                      {cleanNights >= 3 ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <Clock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                      )}
                      3. 연속 무오류 밤
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {cleanNights}일 연속 (기준 3일)
                    </p>
                  </div>

                  <div className="rounded-md border bg-background p-2 space-y-0.5">
                    <div className="flex items-center gap-1 font-medium">
                      {restoreOk ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <Clock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                      )}
                      4. 복원 헬스 검증
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {restoreOk ? formatWhen(status?.last_verified_restore_at) : "검증 대기"}
                    </p>
                  </div>

                  <div className="rounded-md border bg-background p-2 space-y-0.5">
                    <div className="flex items-center gap-1 font-medium">
                      {quotaOk ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <Clock className="h-3.5 w-3.5 text-destructive shrink-0" />
                      )}
                      5. 카나리 · 용량
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      카나리 {status?.consecutive_canary_success_nights ?? 0}/2밤 → 틱당{" "}
                      {(status?.consecutive_canary_success_nights ?? 0) >= 2
                        ? status?.normal_max_purge_per_tick ?? 15
                        : status?.canary_max_purge_per_tick ?? 5}
                      건
                    </p>
                  </div>
                </div>

                {status?.last_disarm_reason && (
                  <p className="text-xs text-destructive">
                    마지막 자동/수동 해제 사유: {status.last_disarm_reason}
                  </p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Domain Breakdown & Recent Runs */}
      {!loading && (
        <div className="grid lg:grid-cols-[320px_1fr] gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">업무별 보관 · 삭제 현황</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {(dash?.by_domain || []).length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">집계 데이터가 없습니다.</p>
              ) : (
                (dash?.by_domain || []).map((d) => (
                  <div
                    key={d.domain}
                    className="flex items-center justify-between gap-2 rounded border px-2.5 py-1.5 text-xs"
                  >
                    <span className="font-medium truncate">
                      {DOMAIN_LABELS[d.domain] || d.domain}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-muted-foreground">
                      <span>백업 <b className="text-foreground">{d.backed_up_count}</b></span>
                      <span>· 삭제 <b className="text-emerald-600">{d.purged_count}</b></span>
                      <span>· {formatBytesAuto(d.total_bytes)}</span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-primary" />
                최근 심야 백업 · 삭제 실행 이력 (최근 12회)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(dash?.recent_runs || []).length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">실행 이력이 없습니다.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground text-left">
                        <th className="py-1.5 pr-2 font-medium">실행 시각 (KST)</th>
                        <th className="py-1.5 px-2 font-medium">모드</th>
                        <th className="py-1.5 px-2 font-medium text-right">복사·검증</th>
                        <th className="py-1.5 px-2 font-medium text-right">삭제</th>
                        <th className="py-1.5 px-2 font-medium text-right">오류</th>
                        <th className="py-1.5 pl-2 font-medium text-right">소요</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(dash?.recent_runs || []).map((r) => (
                        <tr key={r.id} className="border-b last:border-0">
                          <td className="py-1.5 pr-2 whitespace-nowrap">{formatWhen(r.started_at)}</td>
                          <td className="py-1.5 px-2">
                            <Badge
                              variant={r.purged_cnt > 0 ? "default" : "outline"}
                              className="text-[10px] h-4"
                            >
                              {r.mode === "backup_only" ? "백업 전용" : r.mode}
                            </Badge>
                          </td>
                          <td className="py-1.5 px-2 text-right font-medium">
                            {r.copied_cnt}/{r.verified_cnt}
                          </td>
                          <td className="py-1.5 px-2 text-right font-medium text-emerald-600">
                            {r.purged_cnt}
                          </td>
                          <td className={`py-1.5 px-2 text-right font-medium ${r.error_cnt > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                            {r.error_cnt}
                          </td>
                          <td className="py-1.5 pl-2 text-right text-muted-foreground">
                            {formatDurationSec(r.started_at, r.finished_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default SettingsStorageArchive;
