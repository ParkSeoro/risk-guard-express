import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList, Download, Search, AlertTriangle, CheckCircle2, LogIn } from "lucide-react";
import { toast } from "sonner";
import { useGlobalProjectAccess } from '@/components/AppLayout';

type EntryLog = {
  id: string;
  worker_id: string;
  entry_at: string;
  exit_at: string | null;
  risk_assessment_confirmed?: boolean;
  education_confirmed?: boolean;
  tbm_confirmed?: boolean;
  no_accident_confirmed?: boolean;
  workers?: { name?: string; phone?: string; company_name?: string };
};

type StatusFilter = "all" | "inside" | "exited" | "incomplete";

export default function WorkerAttendance() {
  const [projectId, setProjectId] = useState<string>(() => localStorage.getItem("currentProjectId") || "");
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [logs, setLogs] = useState<EntryLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const { isMaster, isProjectAdmin, isSafetyManager, userCompanyId } = useGlobalProjectAccess();

  useEffect(() => {
    supabase.from("projects").select("id,name").then(({ data }) => setProjects(data || []));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    localStorage.setItem("currentProjectId", projectId);
    load();
    const ch = supabase
      .channel(`worker_entry_logs:${projectId}:${date}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "worker_entry_logs", filter: `project_id=eq.${projectId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [projectId, date]);


  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("worker_entry_logs")
        .select("*")
        .eq("project_id", projectId)
        .gte("entry_at", date + "T00:00:00")
        .lte("entry_at", date + "T23:59:59")
        .order("entry_at", { ascending: false });
      if (error) { toast.error(error.message); return; }
      const ids = Array.from(new Set((data || []).map((l: any) => l.worker_id).filter(Boolean)));
      let workersMap: Record<string, any> = {};
      if (ids.length) {
        const { data: ws } = await supabase.from("workers").select("id,name,phone,company_name").in("id", ids);
        workersMap = Object.fromEntries((ws || []).map((w: any) => [w.id, w]));
      }
      setLogs((data || []).map((l: any) => ({ ...l, workers: workersMap[l.worker_id] })));
    } finally {
      setLoading(false);
    }
  };

  const companies = useMemo(() => {
    const set = new Set<string>();
    logs.forEach(l => { if (l.workers?.company_name) set.add(l.workers.company_name); });
    return Array.from(set).sort();
  }, [logs]);

  const isIncomplete = (l: EntryLog) =>
    !(l.risk_assessment_confirmed && l.education_confirmed && l.tbm_confirmed);

  const counts = useMemo(() => {
    const c = { all: logs.length, inside: 0, exited: 0, incomplete: 0, noAccident: 0 };
    for (const l of logs) {
      if (l.exit_at) c.exited++; else c.inside++;
      if (isIncomplete(l)) c.incomplete++;
      if (l.no_accident_confirmed) c.noAccident++;
    }
    return c;
  }, [logs]);

  // 권한 기반 회사 격리: 비-관리자급은 RLS에 위임 (workers.company_name은 이름 문자열이라 id 매칭 불가)
  const scopedLogs = useMemo(() => {
    if (isMaster || isProjectAdmin || isSafetyManager) return logs;
    // 추가 가시화 필터가 필요하면 추후 company_name 매핑 도입
    return logs;
  }, [logs, isMaster, isProjectAdmin, isSafetyManager, userCompanyId]);


  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scopedLogs.filter(l => {
      if (companyFilter !== "all" && l.workers?.company_name !== companyFilter) return false;
      if (status === "inside" && l.exit_at) return false;
      if (status === "exited" && !l.exit_at) return false;
      if (status === "incomplete" && !isIncomplete(l)) return false;
      if (!q) return true;
      return (
        (l.workers?.name || "").toLowerCase().includes(q) ||
        (l.workers?.phone || "").toLowerCase().includes(q) ||
        (l.workers?.company_name || "").toLowerCase().includes(q)
      );
    });
  }, [scopedLogs, search, companyFilter, status]);

  const exportCsv = () => {
    const rows = [
      ["이름", "전화", "소속", "입장시각", "퇴장시각", "위험성평가", "교육", "TBM", "무재해"],
      ...filteredLogs.map(l => [
        l.workers?.name, l.workers?.phone, l.workers?.company_name,
        new Date(l.entry_at).toLocaleString("ko-KR"),
        l.exit_at ? new Date(l.exit_at).toLocaleString("ko-KR") : "-",
        l.risk_assessment_confirmed ? "O" : "X",
        l.education_confirmed ? "O" : "X",
        l.tbm_confirmed ? "O" : "X",
        l.no_accident_confirmed ? "O" : "-",
      ]),
    ];
    const csv = "\uFEFF" + rows.map(r => r.map(c => `"${c ?? ""}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `입퇴장_${date}.csv`;
    a.click();
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardList className="h-6 w-6" /> 입퇴장 현황</h1>

      <Card>
        <CardContent className="pt-4 flex gap-2 items-end flex-wrap">
          <div>
            <Label>프로젝트</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-64"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
              <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>날짜</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <Label>시공사</Label>
            <Select value={companyFilter} onValueChange={setCompanyFilter}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                {companies.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <Label>검색</Label>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="이름·전화·소속" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-2" />CSV</Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 flex items-center justify-between">
          <div><div className="text-xs text-muted-foreground">입장중</div><div className="text-2xl font-bold">{counts.inside}</div></div>
          <LogIn className="h-6 w-6 text-primary" />
        </CardContent></Card>
        <Card><CardContent className="pt-4 flex items-center justify-between">
          <div><div className="text-xs text-muted-foreground">퇴장완료</div><div className="text-2xl font-bold">{counts.exited}</div></div>
          <CheckCircle2 className="h-6 w-6 text-success" />
        </CardContent></Card>
        <Card><CardContent className="pt-4 flex items-center justify-between">
          <div><div className="text-xs text-muted-foreground">확인 미완</div><div className="text-2xl font-bold text-destructive">{counts.incomplete}</div></div>
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </CardContent></Card>
        <Card><CardContent className="pt-4 flex items-center justify-between">
          <div><div className="text-xs text-muted-foreground">무재해 서명</div><div className="text-2xl font-bold">{counts.noAccident}</div></div>
          <Badge className="bg-success">무재해</Badge>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle>{date} 입퇴장 ({filteredLogs.length}/{scopedLogs.length}건)</CardTitle>
          <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <TabsList>
              <TabsTrigger value="all">전체</TabsTrigger>
              <TabsTrigger value="inside">입장중</TabsTrigger>
              <TabsTrigger value="exited">퇴장</TabsTrigger>
              <TabsTrigger value="incomplete">확인미완</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              {scopedLogs.length === 0 ? "기록이 없습니다." : "필터에 해당하는 기록이 없습니다."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="text-left p-2">근로자</th>
                    <th className="text-left p-2">소속</th>
                    <th className="text-left p-2">입장</th>
                    <th className="text-left p-2">퇴장</th>
                    <th className="text-left p-2">확인사항</th>
                    <th className="text-left p-2">무재해</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map(l => {
                    const incomplete = isIncomplete(l);
                    return (
                      <tr key={l.id} className={`border-b ${incomplete ? "bg-destructive/5" : ""}`}>
                        <td className="p-2"><div className="font-medium">{l.workers?.name || "—"}</div><div className="text-xs text-muted-foreground">{l.workers?.phone}</div></td>
                        <td className="p-2">{l.workers?.company_name || "-"}</td>
                        <td className="p-2 text-xs">{new Date(l.entry_at).toLocaleTimeString("ko-KR")}</td>
                        <td className="p-2 text-xs">{l.exit_at ? new Date(l.exit_at).toLocaleTimeString("ko-KR") : <Badge>입장중</Badge>}</td>
                        <td className="p-2">
                          <div className="flex gap-1 flex-wrap">
                            <Badge variant={l.risk_assessment_confirmed ? "outline" : "destructive"} className="text-xs">위험</Badge>
                            <Badge variant={l.education_confirmed ? "outline" : "destructive"} className="text-xs">교육</Badge>
                            <Badge variant={l.tbm_confirmed ? "outline" : "destructive"} className="text-xs">TBM</Badge>
                          </div>
                        </td>
                        <td className="p-2">{l.no_accident_confirmed ? <Badge className="bg-success">무재해</Badge> : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
