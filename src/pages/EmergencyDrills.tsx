import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectAccess } from "@/hooks/useProjectAccess";
import { useSoftDelete } from "@/hooks/useSoftDelete";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Siren, Plus, CalendarClock, CheckCircle2, AlertTriangle, Search, Timer } from "lucide-react";

import { toast } from "sonner";

type Drill = {
  id: string;
  project_id: string;
  drill_type: string;
  title: string;
  scenario: string;
  scheduled_date: string | null;
  conducted_date: string | null;
  location: string;
  leader_name: string;
  participants_count: number;
  issues_found: string;
  improvements: string;
  next_due_date: string | null;
  status: string;
  legal_basis: string;
};

const TYPE_LABEL: Record<string, string> = {
  evacuation: "대피훈련",
  fire: "화재진압",
  earthquake: "지진대응",
  chemical_leak: "화학물질누출",
  rescue: "구조훈련",
  first_aid: "응급처치",
};

export default function EmergencyDrills() {
  const { selectedProject: projectId } = useProjectAccess();
  const { softDelete } = useSoftDelete();
  const [rows, setRows] = useState<Drill[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Drill | null>(null);
  const [search, setSearch] = useState("");
  const [statusTab, setStatusTab] = useState<"all" | "upcoming" | "done" | "overdue">("all");


  const [form, setForm] = useState({
    drill_type: "evacuation",
    title: "",
    scenario: "",
    scheduled_date: "",
    conducted_date: "",
    location: "",
    leader_name: "",
    participants_count: 0,
    issues_found: "",
    improvements: "",
  });

  async function load() {
    if (!projectId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("emergency_drills")
      .select("*")
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .order("scheduled_date", { ascending: false, nullsFirst: false });
    if (error) toast.error(error.message);
    setRows((data as Drill[]) || []);
    setLoading(false);
  }
  useEffect(() => {
    if (!projectId) return;
    load();
    const ch = supabase
      .channel(`emergency_drills:${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "emergency_drills", filter: `project_id=eq.${projectId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [projectId]);

  function nextDueLabel(iso: string | null): { text: string; tone: "ok" | "warn" | "danger" } | null {
    if (!iso) return null;
    const diffDays = Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000);
    if (diffDays < 0) return { text: `초과 ${-diffDays}일`, tone: "danger" };
    if (diffDays <= 30) return { text: `D-${diffDays}일`, tone: "warn" };
    return { text: `D-${diffDays}일`, tone: "ok" };
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    return rows.filter(r => {
      if (statusTab === "upcoming" && !(r.status === "planned" && r.scheduled_date && new Date(r.scheduled_date).getTime() >= now)) return false;
      if (statusTab === "done" && r.status !== "done") return false;
      if (statusTab === "overdue" && !(r.next_due_date && new Date(r.next_due_date).getTime() < now)) return false;
      if (!q) return true;
      return (r.title || "").toLowerCase().includes(q)
        || (r.location || "").toLowerCase().includes(q)
        || (r.leader_name || "").toLowerCase().includes(q);
    });
  }, [rows, search, statusTab]);

  const overdueCount = useMemo(
    () => rows.filter(r => r.next_due_date && new Date(r.next_due_date).getTime() < Date.now()).length,
    [rows]
  );


  const stats = useMemo(() => {
    const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const recent = rows.filter(r => r.conducted_date && new Date(r.conducted_date) >= oneYearAgo);
    const upcoming = rows.filter(r => r.status === "planned" && r.scheduled_date && new Date(r.scheduled_date) >= new Date());
    const compliant = recent.length > 0;
    return { total: rows.length, recent: recent.length, upcoming: upcoming.length, compliant };
  }, [rows]);

  function openCreate() {
    setEditing(null);
    setForm({ drill_type: "evacuation", title: "", scenario: "", scheduled_date: "", conducted_date: "", location: "", leader_name: "", participants_count: 0, issues_found: "", improvements: "" });
    setOpen(true);
  }
  function openEdit(r: Drill) {
    setEditing(r);
    setForm({
      drill_type: r.drill_type, title: r.title, scenario: r.scenario,
      scheduled_date: r.scheduled_date || "", conducted_date: r.conducted_date || "",
      location: r.location, leader_name: r.leader_name, participants_count: r.participants_count,
      issues_found: r.issues_found, improvements: r.improvements,
    });
    setOpen(true);
  }

  async function save() {
    if (!projectId) return;
    if (!form.title.trim()) { toast.error("훈련명을 입력하세요"); return; }
    const payload: any = {
      project_id: projectId,
      drill_type: form.drill_type,
      title: form.title.trim(),
      scenario: form.scenario,
      scheduled_date: form.scheduled_date || null,
      conducted_date: form.conducted_date || null,
      location: form.location,
      leader_name: form.leader_name,
      participants_count: Number(form.participants_count) || 0,
      issues_found: form.issues_found,
      improvements: form.improvements,
    };
    const { error } = editing
      ? await supabase.from("emergency_drills").update(payload).eq("id", editing.id)
      : await supabase.from("emergency_drills").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success(editing ? "수정 완료" : "등록 완료");
    setOpen(false);
    load();
  }

  async function handleDelete(r: Drill) {
    const res = await softDelete("emergency_drills", r.id, { projectId, label: r.title });
    if (res.ok) load();
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Siren className="text-orange-600" /> 비상대피훈련</h1>
          <p className="text-sm text-muted-foreground">산안법 §52 / 시행규칙 §38 — 비상조치계획 연 1회 이상 실시</p>
        </div>
        <Button onClick={openCreate}><Plus className="size-4 mr-1" /> 훈련 등록</Button>
      </header>

      <div className="grid grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">전체</div><div className="text-2xl font-bold">{stats.total}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">최근 1년 실시</div><div className="text-2xl font-bold text-green-600">{stats.recent}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">예정</div><div className="text-2xl font-bold">{stats.upcoming}</div></CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">법정 이행</div>
          <div className="text-lg font-bold flex items-center gap-1">
            {stats.compliant
              ? <><CheckCircle2 className="size-5 text-green-600" /> 충족</>
              : <><AlertTriangle className="size-5 text-destructive" /> 미충족</>}
          </div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">훈련 이력</CardTitle>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="훈련명·장소·진행자 검색" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <Tabs value={statusTab} onValueChange={(v) => setStatusTab(v as any)}>
            <TabsList>
              <TabsTrigger value="all">전체 <Badge variant="secondary" className="ml-1">{rows.length}</Badge></TabsTrigger>
              <TabsTrigger value="upcoming">예정 <Badge variant="secondary" className="ml-1">{stats.upcoming}</Badge></TabsTrigger>
              <TabsTrigger value="done">완료 <Badge variant="secondary" className="ml-1">{stats.recent}</Badge></TabsTrigger>
              <TabsTrigger value="overdue">차기 초과 <Badge variant="destructive" className="ml-1">{overdueCount}</Badge></TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : rows.length === 0 ? (
            <div className="text-center py-10 space-y-3">
              <Siren className="size-10 mx-auto text-orange-500" />
              <div className="text-sm text-muted-foreground">등록된 훈련 없음 — 산안법 §52 연 1회 이상 실시 필요</div>
              <Button onClick={openCreate}><Plus className="size-4 mr-1" /> 첫 훈련 등록</Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">검색/필터 결과 없음</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="p-2">유형</th><th className="p-2">훈련명</th>
                    <th className="p-2">예정일</th><th className="p-2">실시일</th>
                    <th className="p-2">장소</th><th className="p-2">진행자</th>
                    <th className="p-2">참여</th><th className="p-2">상태</th>
                    <th className="p-2">차기예정</th><th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => {
                    const due = nextDueLabel(r.next_due_date);
                    return (
                      <tr key={r.id} className="border-t hover:bg-muted/30">
                        <td className="p-2"><Badge variant="outline">{TYPE_LABEL[r.drill_type] || r.drill_type}</Badge></td>
                        <td className="p-2 font-medium">{r.title}</td>
                        <td className="p-2 whitespace-nowrap">{r.scheduled_date || "-"}</td>
                        <td className="p-2 whitespace-nowrap">{r.conducted_date || "-"}</td>
                        <td className="p-2">{r.location}</td>
                        <td className="p-2">{r.leader_name}</td>
                        <td className="p-2 text-center">{r.participants_count}</td>
                        <td className="p-2">
                          <Badge variant={r.status === "done" ? "outline" : "secondary"}>
                            {r.status === "done" ? "완료" : r.status === "cancelled" ? "취소" : "예정"}
                          </Badge>
                        </td>
                        <td className="p-2 whitespace-nowrap text-xs">
                          {due ? (
                            <Badge variant={due.tone === "danger" ? "destructive" : due.tone === "warn" ? "secondary" : "outline"}>
                              <Timer className="size-3 mr-1" />{due.text}
                            </Badge>
                          ) : r.next_due_date ? (
                            <span className="flex items-center gap-1"><CalendarClock className="size-3" />{r.next_due_date}</span>
                          ) : "-"}
                        </td>
                        <td className="p-2 space-x-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>수정</Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(r)}>삭제</Button>
                        </td>
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
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "훈련 수정" : "비상대피훈련 등록"}</DialogTitle></DialogHeader>
          <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>훈련 유형</Label>
                <Select value={form.drill_type} onValueChange={v => setForm({ ...form, drill_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(TYPE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>훈련명</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
            </div>
            <div><Label>시나리오</Label><Textarea rows={3} value={form.scenario} onChange={e => setForm({ ...form, scenario: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>예정일</Label><Input type="date" value={form.scheduled_date} onChange={e => setForm({ ...form, scheduled_date: e.target.value })} /></div>
              <div><Label>실시일</Label><Input type="date" value={form.conducted_date} onChange={e => setForm({ ...form, conducted_date: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>장소</Label><Input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} /></div>
              <div><Label>진행자</Label><Input value={form.leader_name} onChange={e => setForm({ ...form, leader_name: e.target.value })} /></div>
              <div><Label>참여 인원</Label><Input type="number" min={0} value={form.participants_count} onChange={e => setForm({ ...form, participants_count: Number(e.target.value) })} /></div>
            </div>
            <div><Label>발견된 문제점</Label><Textarea rows={2} value={form.issues_found} onChange={e => setForm({ ...form, issues_found: e.target.value })} /></div>
            <div><Label>개선사항</Label><Textarea rows={2} value={form.improvements} onChange={e => setForm({ ...form, improvements: e.target.value })} /></div>
            <p className="text-xs text-muted-foreground">실시일 입력 시 차기 예정일이 자동으로 1년 뒤로 설정됩니다 (법정 주기).</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>취소</Button>
            <Button onClick={save}>{editing ? "수정" : "등록"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
