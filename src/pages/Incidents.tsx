import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectAccess } from "@/hooks/useProjectAccess";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertOctagon, Plus, Timer, FileWarning, CheckCircle2, Search } from "lucide-react";
import { toast } from "sonner";

type Row = {
  id: string;
  project_id: string;
  reporter_name: string;
  incident_type: string;
  severity: string;
  occurred_at: string;
  location: string;
  description: string;
  status: string;
  is_major: boolean;
  legal_deadline_at: string | null;
  reported_to_authority_at: string | null;
  authority_report_no: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  near_miss: "아차사고", minor: "경미사고", major: "중대사고", property: "재산피해",
};
const SEV_LABEL: Record<string, string> = { low: "낮음", medium: "보통", high: "높음", critical: "심각", major: "중대" };

function deadlineLabel(iso: string | null): { text: string; tone: "ok" | "warn" | "danger" } {
  if (!iso) return { text: "-", tone: "ok" };
  const diffMs = new Date(iso).getTime() - Date.now();
  const h = Math.floor(Math.abs(diffMs) / 3_600_000);
  if (diffMs < 0) return { text: `초과 ${h}시간`, tone: "danger" };
  if (h < 6) return { text: `D-${h}시간`, tone: "danger" };
  if (h < 24) return { text: `D-${h}시간`, tone: "warn" };
  return { text: `D-${Math.floor(h / 24)}일`, tone: "ok" };
}

export default function Incidents() {
  const { selectedProject: projectId } = useProjectAccess();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState<Row | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "major" | "overdue" | "reported">("all");

  const [form, setForm] = useState({
    reporter_name: "",
    incident_type: "near_miss",
    severity: "low",
    location: "",
    description: "",
    occurred_at: new Date().toISOString().slice(0, 16),
  });

  async function load() {
    if (!projectId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("incident_reports")
      .select("*")
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .order("occurred_at", { ascending: false });
    if (error) toast.error(error.message);
    setRows((data as Row[]) || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, [projectId]);

  const stats = useMemo(() => {
    const major = rows.filter(r => r.is_major);
    const overdue = major.filter(r => !r.reported_to_authority_at && r.legal_deadline_at && new Date(r.legal_deadline_at) < new Date());
    return { total: rows.length, major: major.length, overdue: overdue.length };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (statusFilter === "major" && !r.is_major) return false;
      if (statusFilter === "overdue" && !(r.is_major && !r.reported_to_authority_at && r.legal_deadline_at && new Date(r.legal_deadline_at) < new Date())) return false;
      if (statusFilter === "reported" && !r.reported_to_authority_at) return false;
      if (!q) return true;
      return (r.reporter_name || "").toLowerCase().includes(q)
        || (r.location || "").toLowerCase().includes(q)
        || (r.description || "").toLowerCase().includes(q);
    });
  }, [rows, search, statusFilter]);

  async function submitReport() {
    if (!projectId) return;
    if (!form.reporter_name.trim() || !form.location.trim() || form.description.trim().length < 5) {
      toast.error("필수 항목을 입력하세요");
      return;
    }
    const isMajor = form.incident_type === "major" || form.severity === "high";
    const { error } = await supabase.from("incident_reports").insert({
      project_id: projectId,
      reporter_name: form.reporter_name.trim(),
      incident_type: form.incident_type,
      severity: form.severity,
      location: form.location.trim(),
      description: form.description.trim(),
      occurred_at: new Date(form.occurred_at).toISOString(),
      is_major: isMajor,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(isMajor ? "중대재해 등록 — 24시간 보고 시한 카운트다운 시작" : "사고 등록 완료");
    setOpen(false);
    setForm({ ...form, location: "", description: "", reporter_name: "" });
    load();
  }

  async function markReported(row: Row, reportNo: string) {
    const { error } = await supabase
      .from("incident_reports")
      .update({ reported_to_authority_at: new Date().toISOString(), authority_report_no: reportNo, status: "reported" })
      .eq("id", row.id);
    if (error) { toast.error(error.message); return; }
    toast.success("관할 노동청 보고 완료 기록됨");
    setReportOpen(null);
    load();
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><AlertOctagon className="text-destructive" /> 사고 관리</h1>
          <p className="text-sm text-muted-foreground">아차사고·경미·중대재해 통합 관리 (산안법 §57 24시간 보고)</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="size-4 mr-1" /> 사고 보고</Button>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">전체</div><div className="text-2xl font-bold">{stats.total}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">중대재해</div><div className="text-2xl font-bold text-orange-600">{stats.major}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">보고 시한 초과</div><div className="text-2xl font-bold text-destructive">{stats.overdue}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">사고 목록</CardTitle>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="신고자/위치/내용 검색" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <TabsList>
              <TabsTrigger value="all">전체 <Badge variant="secondary" className="ml-1">{rows.length}</Badge></TabsTrigger>
              <TabsTrigger value="major">중대 <Badge variant="secondary" className="ml-1">{stats.major}</Badge></TabsTrigger>
              <TabsTrigger value="overdue">시한초과 <Badge variant="destructive" className="ml-1">{stats.overdue}</Badge></TabsTrigger>
              <TabsTrigger value="reported">보고완료</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : rows.length === 0 ? (
            <div className="text-center py-10 space-y-3">
              <AlertOctagon className="size-10 mx-auto text-muted-foreground" />
              <div className="text-sm text-muted-foreground">등록된 사고가 없습니다 — 아차사고도 적극 보고해 주세요</div>
              <Button onClick={() => setOpen(true)}><Plus className="size-4 mr-1" /> 사고 보고</Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">검색/필터 결과 없음</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="p-2">발생일시</th><th className="p-2">유형</th><th className="p-2">강도</th>
                    <th className="p-2">위치</th><th className="p-2">신고자</th>
                    <th className="p-2">24h 시한</th><th className="p-2">노동청 보고</th><th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => {
                    const d = deadlineLabel(r.legal_deadline_at);
                    return (
                      <tr key={r.id} className="border-t">
                        <td className="p-2 whitespace-nowrap">{new Date(r.occurred_at).toLocaleString("ko-KR")}</td>
                        <td className="p-2">{TYPE_LABEL[r.incident_type] || r.incident_type}</td>
                        <td className="p-2">{r.is_major && <Badge variant="destructive" className="mr-1">중대</Badge>}{SEV_LABEL[r.severity] || r.severity}</td>
                        <td className="p-2">{r.location}</td>
                        <td className="p-2">{r.reporter_name}</td>
                        <td className="p-2">{r.is_major ? (
                          <Badge variant={d.tone === "danger" ? "destructive" : d.tone === "warn" ? "secondary" : "outline"}>
                            <Timer className="size-3 mr-1" />{d.text}
                          </Badge>
                        ) : "-"}</td>
                        <td className="p-2">{r.reported_to_authority_at
                          ? <Badge variant="outline"><CheckCircle2 className="size-3 mr-1" />{r.authority_report_no || "완료"}</Badge>
                          : r.is_major ? <Badge variant="destructive"><FileWarning className="size-3 mr-1" />미보고</Badge> : "-"}</td>
                        <td className="p-2">{r.is_major && !r.reported_to_authority_at &&
                          <Button size="sm" variant="outline" onClick={() => setReportOpen(r)}>보고 기록</Button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>


      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>사고 보고</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>신고자</Label><Input value={form.reporter_name} onChange={e => setForm({ ...form, reporter_name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>유형</Label>
                <Select value={form.incident_type} onValueChange={v => setForm({ ...form, incident_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(TYPE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>강도</Label>
                <Select value={form.severity} onValueChange={v => setForm({ ...form, severity: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">낮음</SelectItem>
                    <SelectItem value="medium">보통</SelectItem>
                    <SelectItem value="high">높음(중대)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>발생일시</Label>
              <input type="datetime-local" className="w-full border rounded px-3 py-2 bg-background"
                value={form.occurred_at} onChange={e => setForm({ ...form, occurred_at: e.target.value })} />
            </div>
            <div><Label>위치</Label><Input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} /></div>
            <div><Label>내용</Label><Textarea rows={4} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            {(form.incident_type === "major" || form.severity === "high") &&
              <div className="text-xs text-destructive border border-destructive/30 bg-destructive/5 rounded p-2">
                ⚠ 중대재해로 분류됩니다. 발생 시점부터 24시간 이내 관할 노동청 보고 의무가 자동 생성됩니다 (산안법 §57).
              </div>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>취소</Button>
            <Button onClick={submitReport}>등록</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reportOpen} onOpenChange={() => setReportOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>관할 노동청 보고 기록</DialogTitle></DialogHeader>
          <ReportForm onSubmit={no => reportOpen && markReported(reportOpen, no)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReportForm({ onSubmit }: { onSubmit: (no: string) => void }) {
  const [no, setNo] = useState("");
  return (
    <div className="space-y-3">
      <div><Label>보고서 접수번호</Label><Input value={no} onChange={e => setNo(e.target.value)} placeholder="예: 노동청 2026-0001" /></div>
      <DialogFooter><Button onClick={() => no.trim() && onSubmit(no.trim())}>보고 완료 기록</Button></DialogFooter>
    </div>
  );
}
