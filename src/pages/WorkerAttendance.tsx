import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardList, Download } from "lucide-react";
import { toast } from "sonner";

export default function WorkerAttendance() {
  const [projectId, setProjectId] = useState<string>(() => localStorage.getItem("currentProjectId") || "");
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    supabase.from("projects").select("id,name").then(({ data }) => setProjects(data || []));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    localStorage.setItem("currentProjectId", projectId);
    load();
  }, [projectId, date]);

  const load = async () => {
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
  };

  const exportCsv = () => {
    const rows = [
      ["이름", "전화", "소속", "입장시각", "퇴장시각", "위험성평가", "교육", "TBM", "무재해"],
      ...logs.map(l => [
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
              <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>날짜</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-2" />CSV</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{date} 입퇴장 ({logs.length}건)</CardTitle></CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">기록이 없습니다.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted">
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
                  {logs.map(l => (
                    <tr key={l.id} className="border-b">
                      <td className="p-2"><div className="font-medium">{l.workers?.name}</div><div className="text-xs text-muted-foreground">{l.workers?.phone}</div></td>
                      <td className="p-2">{l.workers?.company_name}</td>
                      <td className="p-2 text-xs">{new Date(l.entry_at).toLocaleTimeString("ko-KR")}</td>
                      <td className="p-2 text-xs">{l.exit_at ? new Date(l.exit_at).toLocaleTimeString("ko-KR") : <Badge>입장중</Badge>}</td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          {l.risk_assessment_confirmed && <Badge variant="outline" className="text-xs">위험</Badge>}
                          {l.education_confirmed && <Badge variant="outline" className="text-xs">교육</Badge>}
                          {l.tbm_confirmed && <Badge variant="outline" className="text-xs">TBM</Badge>}
                        </div>
                      </td>
                      <td className="p-2">{l.no_accident_confirmed ? <Badge className="bg-success">무재해</Badge> : "-"}</td>
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
