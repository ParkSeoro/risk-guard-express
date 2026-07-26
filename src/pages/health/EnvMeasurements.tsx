import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToastError } from "@/hooks/useToastError";
import { toast } from "sonner";
import { Plus, ClipboardList, AlertTriangle, Search, Trash2 } from "lucide-react";
import { useGlobalProjectAccess } from '@/components/AppLayout';
import { useSoftDelete } from "@/hooks/useSoftDelete";

const ACTIVE_PROJECT_KEY = "selectedProjectId";
const CATEGORIES = ["소음", "분진", "화학물질", "물리적", "생물학적", "진동", "조명", "고온"];
const ROUNDS = ["1차(상반기)", "2차(하반기)", "수시"];

function daysUntil(d?: string | null) {
  if (!d) return null;
  const diff = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
  return diff;
}

export default function EnvMeasurements() {
  const handle = useToastError();
  const { applyCompanyFilter, userCompanyId } = useGlobalProjectAccess();
  const { softDelete } = useSoftDelete();
  const [list, setList] = useState<any[]>([]);
  const [factors, setFactors] = useState<any[]>([]);
  const [openM, setOpenM] = useState(false);
  const [openF, setOpenF] = useState(false);
  const [mf, setMf] = useState<any>({ round: "1차(상반기)" });
  const [ff, setFf] = useState<any>({ category: "소음" });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "exceeded" | "due">("all");
  const [search, setSearch] = useState("");
  const projectId = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_PROJECT_KEY) : null;

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      let mQ = supabase.from("work_env_measurements").select("*").eq("project_id", projectId).eq("is_deleted", false).order("measure_date", { ascending: false });
      mQ = applyCompanyFilter(mQ);
      const [{ data: m }, { data: f }] = await Promise.all([
        mQ,
        supabase.from("work_env_factors").select("*").eq("project_id", projectId).eq("is_deleted", false).order("name"),
      ]);
      setList(m || []); setFactors(f || []);
    } catch (e) { handle(e, "측정 자료 조회"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [projectId, userCompanyId]);

  useEffect(() => {
    if (!projectId) return;
    const ch = supabase
      .channel(`env_measurements:${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_env_measurements', filter: `project_id=eq.${projectId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_env_factors', filter: `project_id=eq.${projectId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [projectId]);


  const counts = useMemo(() => {
    const exceeded = list.filter(r => r.is_exceeded).length;
    const due = list.filter(r => {
      const d = daysUntil(r.next_due_date);
      return d != null && d <= 30 && d >= 0;
    }).length;
    return { all: list.length, exceeded, due };
  }, [list]);

  const filtered = useMemo(() => {
    let rows = list;
    if (tab === "exceeded") rows = rows.filter(r => r.is_exceeded);
    if (tab === "due") rows = rows.filter(r => {
      const d = daysUntil(r.next_due_date);
      return d != null && d <= 30 && d >= 0;
    });
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter(r =>
      (r.factor_name || "").toLowerCase().includes(q) ||
      (r.location || "").toLowerCase().includes(q) ||
      (r.agency || "").toLowerCase().includes(q)
    );
    return rows;
  }, [list, tab, search]);

  const submitFactor = async () => {
    if (!projectId || !ff.name) { toast.error("인자명 필수"); return; }
    try {
      const { error } = await supabase.from("work_env_factors").insert({
        project_id: projectId, category: ff.category, name: ff.name,
        cas_no: ff.cas_no || null,
        exposure_limit_value: ff.exposure_limit_value ? Number(ff.exposure_limit_value) : null,
        exposure_limit_unit: ff.exposure_limit_unit || null,
      });
      if (error) throw error;
      toast.success("등록됨"); setOpenF(false); setFf({ category: "소음" }); await load();
    } catch (e) { handle(e, "유해인자 등록"); }
  };

  const submitMeasurement = async () => {
    if (!projectId || !mf.measure_date || !mf.factor_id) { toast.error("측정일·인자 필수"); return; }
    try {
      const factor = factors.find(f => f.id === mf.factor_id);
      const measured = mf.measured_value ? Number(mf.measured_value) : null;
      const limit = factor?.exposure_limit_value;
      const exceeded = measured != null && limit != null ? measured > limit : false;
      const { error } = await supabase.from("work_env_measurements").insert({
        project_id: projectId,
        round: mf.round,
        measure_date: mf.measure_date,
        agency: mf.agency || null,
        location: mf.location || null,
        factor_id: mf.factor_id,
        factor_name: factor?.name,
        measured_value: measured,
        unit: factor?.exposure_limit_unit || mf.unit || null,
        exposure_limit: limit,
        is_exceeded: exceeded,
        action_required: exceeded,
        action_summary: mf.action_summary || null,
        next_due_date: mf.next_due_date || null,
      });
      if (error) throw error;
      toast.success(exceeded ? "등록 (노출기준 초과 — 개선조치 필요)" : "등록되었습니다");
      setOpenM(false); setMf({ round: "1차(상반기)" }); await load();
    } catch (e) { handle(e, "측정 등록"); }
  };

  const onDelete = async (row: any) => {
    const res = await softDelete("work_env_measurements", row.id, {
      projectId, label: `${row.factor_name} (${row.measure_date})`,
    });
    if (res.ok) await load();
  };

  if (!projectId) return <div className="p-6 text-muted-foreground">프로젝트를 선택해주세요.</div>;

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardList className="h-6 w-6" />작업환경측정</h1>
          <p className="text-sm text-muted-foreground mt-1">유해인자 측정·노출기준 초과 관리 (산안법 제125조, 반기 1회)</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setOpenF(true)}><Plus className="h-4 w-4 mr-1" />유해인자</Button>
          <Button onClick={() => setOpenM(true)}><Plus className="h-4 w-4 mr-1" />측정 등록</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">측정 기록</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="인자명·장소·기관 검색" className="pl-8 h-9" />
            </div>
          </div>
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
            <TabsList>
              <TabsTrigger value="all">전체 <Badge variant="secondary" className="ml-2">{counts.all}</Badge></TabsTrigger>
              <TabsTrigger value="exceeded">초과 <Badge variant="destructive" className="ml-2">{counts.exceeded}</Badge></TabsTrigger>
              <TabsTrigger value="due">기한 30일 이내 <Badge variant="outline" className="ml-2">{counts.due}</Badge></TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">{[0,1,2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>측정일</TableHead><TableHead>회차</TableHead><TableHead>인자</TableHead>
                  <TableHead>측정값</TableHead><TableHead>노출기준</TableHead><TableHead>판정</TableHead>
                  <TableHead>차회기한</TableHead><TableHead>장소</TableHead><TableHead>기관</TableHead><TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filtered.map(r => {
                    const dd = daysUntil(r.next_due_date);
                    return (
                      <TableRow key={r.id} className={r.is_exceeded ? "bg-destructive/5" : ""}>
                        <TableCell>{r.measure_date}</TableCell>
                        <TableCell><Badge variant="outline">{r.round}</Badge></TableCell>
                        <TableCell>{r.factor_name}</TableCell>
                        <TableCell className="font-mono">{r.measured_value ?? "-"} {r.unit}</TableCell>
                        <TableCell className="font-mono text-xs">{r.exposure_limit ?? "-"} {r.unit}</TableCell>
                        <TableCell>{r.is_exceeded ? <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />초과</Badge> : <Badge>적합</Badge>}</TableCell>
                        <TableCell className="text-xs">
                          {r.next_due_date ? (
                            <span className={dd != null && dd <= 30 ? "text-destructive font-medium" : ""}>
                              {r.next_due_date}{dd != null ? ` (D${dd >= 0 ? '-' : '+'}${Math.abs(dd)})` : ""}
                            </span>
                          ) : "-"}
                        </TableCell>
                        <TableCell className="text-xs">{r.location || "-"}</TableCell>
                        <TableCell className="text-xs">{r.agency || "-"}</TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" onClick={() => onDelete(r)}><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filtered.length === 0 && (
                    <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                      {list.length === 0
                        ? <>측정 기록이 없습니다. <Button variant="link" className="p-0 h-auto" onClick={() => setOpenM(true)}>측정 등록</Button></>
                        : "검색 결과가 없습니다."}
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={openF} onOpenChange={setOpenF}>
        <DialogContent>
          <DialogHeader><DialogTitle>유해인자 등록</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>구분</Label>
              <Select value={ff.category} onValueChange={v => setFf({ ...ff, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>인자명 *</Label><Input value={ff.name || ""} onChange={e => setFf({ ...ff, name: e.target.value })} /></div>
            <div><Label>CAS</Label><Input value={ff.cas_no || ""} onChange={e => setFf({ ...ff, cas_no: e.target.value })} /></div>
            <div><Label>노출기준</Label><Input type="number" value={ff.exposure_limit_value || ""} onChange={e => setFf({ ...ff, exposure_limit_value: e.target.value })} /></div>
            <div className="col-span-2"><Label>단위</Label><Input value={ff.exposure_limit_unit || ""} onChange={e => setFf({ ...ff, exposure_limit_unit: e.target.value })} placeholder="dB, mg/m³, ppm" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpenF(false)}>취소</Button><Button onClick={submitFactor}>등록</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openM} onOpenChange={setOpenM}>
        <DialogContent>
          <DialogHeader><DialogTitle>측정 등록</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>측정일 *</Label><Input type="date" value={mf.measure_date || ""} onChange={e => setMf({ ...mf, measure_date: e.target.value })} /></div>
            <div><Label>회차</Label>
              <Select value={mf.round} onValueChange={v => setMf({ ...mf, round: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ROUNDS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2"><Label>유해인자 *</Label>
              <Select value={mf.factor_id || ""} onValueChange={v => setMf({ ...mf, factor_id: v })}>
                <SelectTrigger><SelectValue placeholder={factors.length === 0 ? "먼저 유해인자를 등록하세요" : "선택"} /></SelectTrigger>
                <SelectContent>{factors.map(f => <SelectItem key={f.id} value={f.id}>{f.category} · {f.name} ({f.exposure_limit_value ?? "-"} {f.exposure_limit_unit ?? ""})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>측정값</Label><Input type="number" value={mf.measured_value || ""} onChange={e => setMf({ ...mf, measured_value: e.target.value })} /></div>
            <div><Label>장소</Label><Input value={mf.location || ""} onChange={e => setMf({ ...mf, location: e.target.value })} /></div>
            <div className="col-span-2"><Label>측정기관</Label><Input value={mf.agency || ""} onChange={e => setMf({ ...mf, agency: e.target.value })} /></div>
            <div className="col-span-2"><Label>개선조치 요약</Label><Input value={mf.action_summary || ""} onChange={e => setMf({ ...mf, action_summary: e.target.value })} /></div>
            <div className="col-span-2"><Label>차회 측정 기한</Label><Input type="date" value={mf.next_due_date || ""} onChange={e => setMf({ ...mf, next_due_date: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpenM(false)}>취소</Button><Button onClick={submitMeasurement}>등록</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
