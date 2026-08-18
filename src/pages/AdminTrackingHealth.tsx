/**
 * 위치 추적 상태 점검 — 하트비트 (F-08).
 * 구역 이벤트 건수가 아니라 "지금 누가 추적 중이고 누가 왜 끊겼는가".
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useGlobalProjectAccess } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Radio, Timer, Unplug, RefreshCw, Wifi } from "lucide-react";
import {
  formatGpsFixAgo,
  GPS_BLOCK_REASON_ADMIN,
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
  const { selectedProject: projectId, projects, setSelectedProject } = useGlobalProjectAccess();
  const [rows, setRows] = useState<GpsHealthRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [zonesMissingFp, setZonesMissingFp] = useState<{ id: string; name: string }[]>([]);
  const [nowTick, setNowTick] = useState(Date.now());

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [{ data, error }, zonesRes] = await Promise.all([
        supabase.rpc("get_gps_tracking_health" as any, { _project_id: projectId }),
        supabase
          .from("site_zones")
          .select("id, name, wifi_fingerprint")
          .eq("project_id", projectId)
          .eq("is_deleted", false),
      ]);
      if (error) {
        setLoadError(error.message);
        setRows([]);
      } else {
        setRows(((data || []) as GpsHealthRow[]).map((r) => ({
          ...r,
          block_reason: (r.block_reason || null) as GpsBlockReason,
          bucket: (r.bucket || "disconnected") as GpsAgeBucket,
        })));
      }
      setZonesMissingFp(
        ((zonesRes.data || []) as any[])
          .filter((z) => !z.wifi_fingerprint || (Array.isArray(z.wifi_fingerprint) && z.wifi_fingerprint.length === 0))
          .map((z) => ({ id: z.id as string, name: z.name as string })),
      );
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowTick(Date.now());
      void load();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const summary = useMemo(() => summarizeGpsHealth(rows), [rows]);
  const problemRows = useMemo(
    () => rows.filter((r) => r.bucket !== "live"),
    [rows],
  );

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" /> 위치 추적 상태 점검
        </h1>
        <div className="flex items-center gap-2">
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
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            새로고침
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        최근 12시간 수신 기준. 추적중 = 5분 이내, 지연 = 5~30분, 두절 = 30분 초과 또는 수신 없음.
        좌표는 이 화면에 표시하지 않습니다.
      </p>

      {loadError && (
        <Card className="border-destructive/40">
          <CardContent className="p-3 text-sm text-destructive">
            {loadError}
            {/does not exist|schema cache/i.test(loadError) && (
              <span className="block text-xs mt-1 text-muted-foreground">
                원격 DB에{" "}
                <code className="text-[10px]">20260818120000_gps_tracking_health.sql</code> 을
                적용한 뒤 다시 열어 주세요.
              </span>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Tile icon={Radio} label="추적중" value={summary.live} tone="info" />
        <Tile icon={Timer} label="지연" value={summary.delayed} tone="warn" />
        <Tile icon={Unplug} label="두절" value={summary.disconnected} tone="danger" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>지연·두절 ({problemRows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {problemRows.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {summary.total === 0
                ? "최근 12시간 추적 기록이 없습니다."
                : "지연·두절된 인원이 없습니다."}
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
                      <td className="py-2 pr-3">{r.worker_name || "—"}</td>
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
                        {r.block_reason
                          ? GPS_BLOCK_REASON_ADMIN[r.block_reason]
                          : r.bucket === "disconnected"
                            ? "수신 없음"
                            : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wifi className="h-4 w-4" /> Wi-Fi 지문 미수집 구역 ({zonesMissingFp.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {zonesMissingFp.length === 0 ? (
            <div className="text-sm text-muted-foreground">모든 구역에 Wi-Fi 지문이 등록되어 있습니다.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {zonesMissingFp.map((z) => (
                <Badge key={z.id} variant="outline">
                  {z.name}
                </Badge>
              ))}
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
