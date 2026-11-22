/**
 * 위치 추적 상태 점검 — 하트비트 (F-08, PR 1-D).
 * 분모: 오늘(KST) 미퇴근 출근자 기준 ("지금 출근했는데 누가 추적 중이고 누가 끊겼는가").
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useGlobalProjectAccess } from "@/components/AppLayout";
import LocationControlBar from "@/components/geofence/LocationControlBar";
import { canViewWorkerDistribution, distributionScopeLabel } from "@/hooks/useDistributionAccess";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Radio, Timer, Unplug, RefreshCw } from "lucide-react";
import {
  formatGpsBlockReason,
  formatGpsFixAgo,
  summarizeGpsHealth,
  type GpsAgeBucket,
  type GpsHealthRow,
} from "@/lib/tracking/gpsTrackingHealth";
import type { GpsBlockReason } from "@/lib/tracking/gpsStatusUi";

const BUCKET_LABEL: Record<GpsAgeBucket, string> = {
  live: "추적중",
  delayed: "지연",
  disconnected: "두절",
};

export default function AdminTrackingHealth() {
  const {
    selectedProject: projectId,
    projects,
    setSelectedProject,
    isMaster,
    userRole,
    userCompanyType,
    seesAllCompanies,
    loading: accessLoading,
  } = useGlobalProjectAccess();
  const canView = canViewWorkerDistribution(userRole, isMaster);
  const scopeLabel = distributionScopeLabel({
    isMaster,
    role: userRole,
    companyType: userCompanyType,
    seesAll: seesAllCompanies,
  });
  const [rows, setRows] = useState<GpsHealthRow[]>([]);
  const [companyFilter, setCompanyFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());

  const load = useCallback(async () => {
    if (!projectId || accessLoading || !canView) return;
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase.rpc("get_gps_tracking_health" as any, {
        _project_id: projectId,
      });
      if (error) {
        setLoadError(error.message);
        setRows([]);
      } else {
        setRows(
          ((data || []) as GpsHealthRow[]).map((r) => ({
            ...r,
            block_reason: (r.block_reason || null) as GpsBlockReason,
            bucket: (r.bucket || "disconnected") as GpsAgeBucket,
          })),
        );
      }
    } finally {
      setLoading(false);
    }
  }, [projectId, accessLoading, canView]);

  useEffect(() => {
    setCompanyFilter("all");
    void load();
  }, [load]);

  useEffect(() => {
    if (accessLoading || !canView) return;
    const id = window.setInterval(() => {
      setNowTick(Date.now());
      void load();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [accessLoading, canView, load]);

  const companies = useMemo(
    () =>
      [...new Set(rows.map((r) => r.company_name || "(미지정)"))].sort((a, b) =>
        a.localeCompare(b, "ko"),
      ),
    [rows],
  );

  const visibleRows = useMemo(
    () =>
      companyFilter === "all"
        ? rows
        : rows.filter((r) => (r.company_name || "(미지정)") === companyFilter),
    [rows, companyFilter],
  );

  const summary = useMemo(() => summarizeGpsHealth(visibleRows), [visibleRows]);
  const problemRows = useMemo(
    () => visibleRows.filter((r) => r.bucket !== "live"),
    [visibleRows],
  );

  if (!accessLoading && !canView) {
    return (
      <div className="p-4 md:p-6 max-w-6xl mx-auto text-sm text-muted-foreground">
        위치 추적 상태 점검은 선택한 현장의 관리자(마스터·프로젝트관리자·안전관리자·현장소장·감리·관리감독자)만 볼 수 있습니다.
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" /> 위치 추적 상태 점검
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          {projects.length > 1 && (
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={projectId}
              onChange={(e) => setSelectedProject(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {companies.length > 1 && (
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
            >
              <option value="all">전체 업체 ({rows.length})</option>
              {companies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            새로고침
          </Button>
        </div>
      </div>

      <LocationControlBar
        projectId={projectId}
        activeTab="tracking-health"
        refreshKey={`${summary.total}:${summary.live}:${summary.delayed}:${summary.disconnected}`}
      />

      <p className="text-sm text-muted-foreground">
        오늘 미퇴근 출근자 기준 ({summary.total}명 · {scopeLabel}). 추적중 = 5분 이내, 지연 = 5~30분, 두절 = 30분 초과 또는 미수신.
        미출근자·퇴근자는 포함하지 않으며 좌표는 이 화면에 표시하지 않습니다.
      </p>

      {loadError && (
        <Card className="border-destructive/40">
          <CardContent className="p-3 text-sm text-destructive">
            {loadError}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Tile icon={Radio} label="추적중" value={summary.live} tone="info" />
        <Tile icon={Timer} label="지연" value={summary.delayed} tone="warn" />
        <Tile icon={Unplug} label="두절·미수신" value={summary.disconnected} tone="danger" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>지연·두절 ({problemRows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {problemRows.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {summary.total === 0
                ? "오늘 현재 미퇴근 출근자가 없습니다."
                : "지연·두절된 출근 인원이 없습니다."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-3 font-medium">이름</th>
                    <th className="py-2 pr-3 font-medium">업체</th>
                    <th className="py-2 pr-3 font-medium">상태</th>
                    <th className="py-2 pr-3 font-medium">마지막 수신</th>
                    <th className="py-2 font-medium">사유</th>
                  </tr>
                </thead>
                <tbody>
                  {problemRows.map((r) => (
                    <tr key={r.worker_id} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        <Link
                          className="hover:underline font-medium"
                          to={`/app/admin/workers/${r.worker_id}`}
                        >
                          {r.worker_name || "—"}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{r.company_name || "—"}</td>
                      <td className="py-2 pr-3">
                        <Badge variant={r.bucket === "delayed" ? "outline" : "destructive"}>
                          {BUCKET_LABEL[r.bucket]}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {formatGpsFixAgo(r.last_fix_at, nowTick)}
                      </td>
                      <td className="py-2">
                        {formatGpsBlockReason(r.block_reason) ||
                          (r.bucket === "disconnected" ? "추적 없음" : "—")}
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
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Radio;
  label: string;
  value: number;
  tone: "info" | "warn" | "danger";
}) {
  const cls =
    tone === "danger"
      ? "text-destructive"
      : tone === "warn"
        ? "text-amber-600"
        : "text-blue-600";
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <Icon className={`h-7 w-7 ${cls}`} />
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className={`text-xl font-bold ${cls}`}>{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
