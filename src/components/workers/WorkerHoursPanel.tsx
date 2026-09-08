import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, Download, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useActiveProject } from "@/hooks/useActiveProject";
import { useAuditLog } from "@/hooks/useAuditLog";
import { todaySeoulDate } from "@/lib/dailyWorkAck";
import {
  seoulWeekStart,
  type HoursRollupGroup,
  formatWorkHours,
  STREAK_WARN_DAYS,
  rollupWorkHours,
  filterWorkHourRows,
  summarizeVisibleHours,
} from "@/lib/workHours";
import { fetchHoursRollup, hoursDisclaimer } from "@/lib/laborEvidence";

function monthStart(day: string) {
  return `${day.slice(0, 7)}-01`;
}

function monthEnd(day: string) {
  const [y, m] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${day.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

export default function WorkerHoursPanel() {
  const { projectId } = useActiveProject();
  const { log } = useAuditLog();
  const today = todaySeoulDate();
  const [preset, setPreset] = useState<"week" | "month" | "custom">("week");
  const [from, setFrom] = useState(() => seoulWeekStart(today));
  const [to, setTo] = useState(today);
  const [group, setGroup] = useState<HoursRollupGroup>("worker");
  const [jobFilter, setJobFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [week52Only, setWeek52Only] = useState(false);
  const [nightOnly, setNightOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [rollup, setRollup] = useState<Awaited<ReturnType<typeof fetchHoursRollup>> | null>(null);

  useEffect(() => {
    if (preset === "week") {
      setFrom(seoulWeekStart(today));
      setTo(today);
    } else if (preset === "month") {
      setFrom(monthStart(today));
      setTo(monthEnd(today));
    }
  }, [preset, today]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    fetchHoursRollup({ projectId, from, to, group })
      .then((r) => {
        if (!cancelled) setRollup(r);
      })
      .catch((e) => toast.error(e.message || "집계 실패"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, from, to, group]);

  const jobs = useMemo(
    () => [...new Set((rollup?.rows || []).map((r) => r.jobType))].sort((a, b) => a.localeCompare(b, "ko")),
    [rollup],
  );
  const companies = useMemo(
    () => [...new Set((rollup?.rows || []).map((r) => r.companyName))].sort((a, b) => a.localeCompare(b, "ko")),
    [rollup],
  );

  const filteredRows = useMemo(
    () =>
      filterWorkHourRows(rollup?.rows || [], {
        jobType: jobFilter,
        companyName: companyFilter,
        search,
        nightOnly,
      }),
    [rollup, jobFilter, companyFilter, nightOnly, search],
  );

  const display = useMemo(() => {
    let items = rollupWorkHours(filteredRows, group);
    if (week52Only) items = items.filter((r) => r.week52WarnCount > 0 || r.week52CautionCount > 0);
    return items;
  }, [filteredRows, group, week52Only]);

  const summary = useMemo(
    () => summarizeVisibleHours(filteredRows, week52Only),
    [filteredRows, week52Only],
  );

  const exportExcel = () => {
    const rows = filteredRows.map((r) => ({
      일자: r.workDate,
      성명: r.workerName,
      소속: r.companyName,
      직종: r.jobType,
      입장: new Date(r.entryAt).toLocaleString("ko-KR"),
      퇴장: r.exitAt ? new Date(r.exitAt).toLocaleString("ko-KR") : "",
      분: r.minutes ?? "",
      시간: formatWorkHours(r.minutes),
      공수: r.manDays ?? "",
      야간분: r.nightMinutes,
      일요: r.sunday ? "Y" : "",
      미퇴근: r.incomplete ? "Y" : "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "근로시간");
    XLSX.writeFile(wb, `출근부_근로시간_${from}_${to}.xlsx`);
    void log("export", "work_hours", projectId || "", projectId || undefined, { from, to, count: rows.length });
    toast.success("엑셀 다운로드를 시작했습니다");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Clock className="h-5 w-5" /> 기간 근로시간
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">{hoursDisclaimer()}</p>
        </div>
        <Button onClick={exportExcel} variant="outline" className="gap-2" disabled={!filteredRows.length}>
          <Download className="h-4 w-4" />
          출근부 엑셀
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4 flex gap-2 items-end flex-wrap">
          <div>
            <Label>기간</Label>
            <Select value={preset} onValueChange={(v) => setPreset(v as typeof preset)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="week">이번 주</SelectItem>
                <SelectItem value="month">이번 달</SelectItem>
                <SelectItem value="custom">직접</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>시작</Label>
            <Input type="date" value={from} onChange={(e) => { setPreset("custom"); setFrom(e.target.value); }} />
          </div>
          <div>
            <Label>종료</Label>
            <Input type="date" value={to} onChange={(e) => { setPreset("custom"); setTo(e.target.value); }} />
          </div>
          <div>
            <Label>집계</Label>
            <Select value={group} onValueChange={(v) => setGroup(v as HoursRollupGroup)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="worker">개인</SelectItem>
                <SelectItem value="job_type">직종</SelectItem>
                <SelectItem value="company">협력사</SelectItem>
                <SelectItem value="project">전체</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>직종</Label>
            <Select value={jobFilter} onValueChange={setJobFilter}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                {jobs.map((j) => (
                  <SelectItem key={j} value={j}>{j}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>협력사</Label>
            <Select value={companyFilter} onValueChange={setCompanyFilter}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <Label>검색</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="이름·소속·직종" />
          </div>
          <Button variant={week52Only ? "default" : "outline"} size="sm" onClick={() => setWeek52Only((v) => !v)}>
            주52 경고
          </Button>
          <Button variant={nightOnly ? "default" : "outline"} size="sm" onClick={() => setNightOnly((v) => !v)}>
            야간
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="출역 인원" value={summary?.workerCount ?? 0} />
        <Kpi label="총 시간" value={formatWorkHours(summary?.minutes ?? 0)} />
        <Kpi label="총 공수" value={(summary?.manDays ?? 0).toFixed(2)} />
        <Kpi label="미퇴근" value={summary?.incompleteCount ?? 0} warn={(summary?.incompleteCount || 0) > 0} />
        <Kpi label="주52 경고" value={summary?.week52WarnCount ?? 0} warn={(summary?.week52WarnCount || 0) > 0} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {from} ~ {to} · {groupLabel(group)} ({display.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          ) : display.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">집계할 출역 기록이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-2">{groupLabel(group)}</th>
                    <th className="text-right p-2">인원</th>
                    <th className="text-right p-2">일수</th>
                    <th className="text-right p-2">시간</th>
                    <th className="text-right p-2">공수</th>
                    <th className="text-right p-2">야간</th>
                    <th className="text-right p-2">미퇴근</th>
                    <th className="text-right p-2">주52</th>
                    <th className="text-right p-2">연속</th>
                  </tr>
                </thead>
                <tbody>
                  {display.map((r) => (
                    <tr key={r.key} className="border-b">
                      <td className="p-2 font-medium">
                        {group === "worker" ? (
                          <Link className="underline-offset-2 hover:underline" to={`/app/admin/workers/${r.key}`}>
                            {r.label}
                          </Link>
                        ) : (
                          r.label
                        )}
                      </td>
                      <td className="p-2 text-right">{r.workerCount}</td>
                      <td className="p-2 text-right">{r.dayCount}</td>
                      <td className="p-2 text-right">{formatWorkHours(r.minutes)}</td>
                      <td className="p-2 text-right">{r.manDays.toFixed(2)}</td>
                      <td className="p-2 text-right">{formatWorkHours(r.nightMinutes)}</td>
                      <td className="p-2 text-right">{r.incompleteCount || "—"}</td>
                      <td className="p-2 text-right">
                        {r.week52WarnCount > 0 && <Badge variant="destructive">초과 {r.week52WarnCount}</Badge>}
                        {r.week52WarnCount === 0 && r.week52CautionCount > 0 && (
                          <Badge className="bg-warning text-warning-foreground">주의 {r.week52CautionCount}</Badge>
                        )}
                        {r.week52WarnCount === 0 && r.week52CautionCount === 0 && "—"}
                      </td>
                      <td className="p-2 text-right">
                        {r.maxStreak >= STREAK_WARN_DAYS ? (
                          <span className="text-rose-600 font-semibold inline-flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {r.maxStreak}일
                          </span>
                        ) : (
                          `${r.maxStreak}일`
                        )}
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

function groupLabel(g: HoursRollupGroup) {
  if (g === "job_type") return "직종";
  if (g === "company") return "협력사";
  if (g === "project") return "전체";
  return "근로자";
}

function Kpi({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-bold ${warn ? "text-destructive" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
