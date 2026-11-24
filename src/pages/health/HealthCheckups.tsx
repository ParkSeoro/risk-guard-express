import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToastError } from "@/hooks/useToastError";
import { toast } from "sonner";
import { Plus, Stethoscope, Search, Trash2, Pencil, FileSpreadsheet, Sparkles, Upload, Loader2, ExternalLink } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useGlobalProjectAccess } from '@/components/AppLayout';
import { useSoftDelete } from "@/hooks/useSoftDelete";
import HealthCheckupBulkImportDialog from "@/components/health/HealthCheckupBulkImportDialog";
import HealthCheckupBatchOcrDialog from "@/components/health/HealthCheckupBatchOcrDialog";
import { uploadAttachmentFile } from "@/lib/compressUploadFile";
import { matchWorkerForCheckup } from "@/lib/healthCheckupExcel";
import { analyzeHealthCheckupFile } from "@/lib/healthCheckupOcr";

const TYPES = ["일반", "특수", "배치전", "수시", "임시"];
const RESULTS = ["정상A", "정상B", "요관찰C", "유소견D1", "유소견D2", "판정불가", "미수검"];

function daysUntil(d?: string | null) {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

export default function HealthCheckups() {
  const handle = useToastError();
  const { selectedProject: projectId, applyCompanyFilter, userCompanyId } = useGlobalProjectAccess();
  const { softDelete } = useSoftDelete();
  const [list, setList] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openNew, setOpenNew] = useState(false);
  const [openBulk, setOpenBulk] = useState(false);
  const [openBatchOcr, setOpenBatchOcr] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrSummary, setOcrSummary] = useState<string | null>(null);
  const [enableDailyLog, setEnableDailyLog] = useState(false);
  const [editingRow, setEditingRow] = useState<any | null>(null);
  const [form, setForm] = useState<any>({ type: "일반", result: "미수검" });
  const [tab, setTab] = useState<"all" | "findings" | "untested" | "due">("all");
  const [search, setSearch] = useState("");

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      let hcQ = supabase.from("health_checkups").select("*").eq("project_id", projectId).eq("is_deleted", false).order("scheduled_date", { ascending: false }).limit(500);
      hcQ = applyCompanyFilter(hcQ);
      let wsQ = supabase.from("workers").select("id,name,company_name,phone,company_id").eq("project_id", projectId).eq("is_active", true).order("name");
      wsQ = applyCompanyFilter(wsQ);
      const [{ data: hc }, { data: ws }] = await Promise.all([hcQ, wsQ]);
      setList(hc || []);
      setWorkers(ws || []);
    } catch (e) { handle(e, "건강진단 목록"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [projectId, userCompanyId]);

  useEffect(() => {
    if (!projectId) return;
    const ch = supabase
      .channel(`health_checkups:${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'health_checkups', filter: `project_id=eq.${projectId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [projectId]);


  const counts = useMemo(() => {
    const findings = list.filter(r => (r.result || "").startsWith("유소견")).length;
    const untested = list.filter(r => r.result === "미수검").length;
    const due = list.filter(r => {
      const d = daysUntil(r.next_due_date);
      return d != null && d <= 30 && d >= 0;
    }).length;
    return { all: list.length, findings, untested, due };
  }, [list]);

  const filtered = useMemo(() => {
    let rows = list;
    if (tab === "findings") rows = rows.filter(r => (r.result || "").startsWith("유소견"));
    if (tab === "untested") rows = rows.filter(r => r.result === "미수검");
    if (tab === "due") rows = rows.filter(r => {
      const d = daysUntil(r.next_due_date);
      return d != null && d <= 30 && d >= 0;
    });
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter(r =>
      (r.worker_name || "").toLowerCase().includes(q) ||
      (r.institution || "").toLowerCase().includes(q)
    );
    return rows;
  }, [list, tab, search]);

  const openCreate = () => {
    setEditingRow(null);
    setForm({ type: "일반", result: "미수검", hazard_factors: [], report_url: null });
    setOcrSummary(null);
    setEnableDailyLog(false);
    setOpenNew(true);
  };

  const openEdit = (row: any) => {
    setEditingRow(row);
    setForm({
      worker_id: row.worker_id || "",
      type: row.type || "일반",
      result: row.result || "미수검",
      scheduled_date: row.scheduled_date || "",
      conducted_date: row.conducted_date || "",
      next_due_date: row.next_due_date || "",
      institution: row.institution || "",
      restrictions: row.restrictions || "",
      notes: row.notes || "",
      report_url: row.report_url || null,
      hazard_factors: Array.isArray(row.hazard_factors) ? row.hazard_factors : [],
    });
    setOcrSummary(null);
    setEnableDailyLog(false);
    setOpenNew(true);
  };

  const handleSingleReportOcr = async (file: File) => {
    if (!projectId) return;
    setOcrBusy(true);
    setOcrSummary(null);
    try {
      // 1) Upload original report image/PDF to storage
      const safeName = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${projectId}/health-checkups/${Date.now()}_${safeName}`;
      const [uploaded, ocr] = await Promise.all([
        uploadAttachmentFile(path, file).catch(() => null),
        analyzeHealthCheckupFile(file),
      ]);

      if (!ocr.ok) {
        if (uploaded?.publicUrl) {
          setForm((prev: any) => ({ ...prev, report_url: uploaded.publicUrl }));
        }
        toast.error(ocr.error || "결과지 AI 판독에 실패했습니다. 직접 입력해 주세요.");
        return;
      }

      const matched = ocr.workerName ? matchWorkerForCheckup(ocr.workerName, "", workers) : {};
      setForm((prev: any) => ({
        ...prev,
        worker_id: matched.worker?.id || prev.worker_id || "",
        type: ocr.type || prev.type || "일반",
        result: ocr.result || prev.result || "미수검",
        conducted_date: ocr.conductedDate || prev.conducted_date || "",
        next_due_date: ocr.suggestedNextDueDate || prev.next_due_date || "",
        institution: ocr.institution || prev.institution || "",
        restrictions: ocr.restrictions || prev.restrictions || "",
        hazard_factors: ocr.hazardFactors.length > 0 ? ocr.hazardFactors : (prev.hazard_factors || []),
        report_url: uploaded?.publicUrl || prev.report_url || null,
      }));
      if (ocr.recommendDailyHealthLog) {
        setEnableDailyLog(true);
      }
      const dueNote = !ocr.nextDueDate && ocr.suggestedNextDueDate ? " (차기예정일 산안법 주기 자동 제안)" : "";
      const matchNote = ocr.workerName && !matched.worker ? ` · '${ocr.workerName}' 수동 선택 필요` : "";
      setOcrSummary(
        `${ocr.summary || "AI 판독 완료"}${dueNote}${matchNote}`,
      );
      toast.success("결과지 AI 판독 완료! 내용을 확인·수정한 뒤 저장하세요.");
    } finally {
      setOcrBusy(false);
    }
  };

  const submit = async () => {
    if (!projectId || !form.worker_id || !form.type) {
      toast.error("근로자, 종류는 필수입니다");
      return;
    }
    try {
      const worker = workers.find(w => w.id === form.worker_id);
      const payload = {
        worker_id: form.worker_id,
        company_id: worker?.company_id ?? editingRow?.company_id ?? null,
        worker_name: worker?.name ?? editingRow?.worker_name ?? "",
        worker_phone: worker?.phone ?? editingRow?.worker_phone ?? null,
        type: form.type,
        scheduled_date: form.scheduled_date || null,
        conducted_date: form.conducted_date || null,
        institution: form.institution || null,
        result: form.result || "미수검",
        restrictions: form.restrictions || null,
        next_due_date: form.next_due_date || null,
        notes: form.notes || null,
        report_url: form.report_url || null,
        hazard_factors: Array.isArray(form.hazard_factors) && form.hazard_factors.length > 0 ? form.hazard_factors : null,
      };
      if (editingRow) {
        const { error } = await supabase.from("health_checkups").update(payload as any).eq("id", editingRow.id);
        if (error) throw error;
        toast.success("수정되었습니다");
      } else {
        const { error } = await supabase.from("health_checkups").insert({
          project_id: projectId,
          ...payload,
        } as any);
        if (error) throw error;
        toast.success("등록되었습니다");
      }
      if (enableDailyLog && form.worker_id) {
        await supabase
          .from("workers")
          .update({ requires_daily_health_log: true } as any)
          .eq("id", form.worker_id);
      }
      setOpenNew(false);
      setEditingRow(null);
      setForm({ type: "일반", result: "미수검" });
      await load();
    } catch (e) { handle(e, editingRow ? "건강진단 수정" : "건강진단 등록"); }
  };

  const onDelete = async (row: any) => {
    const res = await softDelete("health_checkups", row.id, {
      projectId, label: `${row.worker_name} · ${row.type}`,
    });
    if (res.ok) await load();
  };

  if (!projectId) return <div className="p-6 text-muted-foreground">프로젝트를 선택해주세요.</div>;

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Stethoscope className="h-6 w-6" />건강진단 관리</h1>
          <p className="text-sm text-muted-foreground mt-1">일반/특수/배치전/수시/임시 건강진단 기록 (산업안전보건법 제129~131조)</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setOpenBatchOcr(true)} className="gap-1.5">
            <Sparkles className="h-4 w-4 text-primary" />결과지 AI 일괄판독
          </Button>
          <Button variant="outline" onClick={() => setOpenBulk(true)} className="gap-1.5">
            <FileSpreadsheet className="h-4 w-4" />엑셀 일괄등록
          </Button>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" />신규 등록</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">진단 기록</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="근로자명·기관 검색" className="pl-8 h-9" />
            </div>
          </div>
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
            <TabsList>
              <TabsTrigger value="all">전체 <Badge variant="secondary" className="ml-2">{counts.all}</Badge></TabsTrigger>
              <TabsTrigger value="findings">유소견 <Badge variant="destructive" className="ml-2">{counts.findings}</Badge></TabsTrigger>
              <TabsTrigger value="untested">미수검 <Badge variant="secondary" className="ml-2">{counts.untested}</Badge></TabsTrigger>
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
                <TableHeader>
                  <TableRow>
                    <TableHead>근로자</TableHead><TableHead>회사</TableHead><TableHead>종류</TableHead>
                    <TableHead>실시일</TableHead><TableHead>결과</TableHead><TableHead>차회 기한</TableHead><TableHead>비고</TableHead><TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(r => {
                    const dd = daysUntil(r.next_due_date);
                    return (
                      <TableRow key={r.id}>
                        <TableCell>{r.worker_name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{(workers.find(w => w.id === r.worker_id)?.company_name) || "-"}</TableCell>
                        <TableCell><Badge variant="outline">{r.type}</Badge></TableCell>
                        <TableCell>{r.conducted_date || r.scheduled_date || "-"}</TableCell>
                        <TableCell>
                          <Badge variant={r.result?.startsWith("유소견") ? "destructive" : r.result === "미수검" ? "secondary" : "default"}>{r.result}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.next_due_date ? (
                            <span className={dd != null && dd <= 30 ? "text-destructive font-medium" : ""}>
                              {r.next_due_date}{dd != null ? ` (D${dd >= 0 ? '-' : '+'}${Math.abs(dd)})` : ""}
                            </span>
                          ) : "-"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-xs">
                          <div className="truncate">{r.restrictions || r.notes || ""}</div>
                          {Array.isArray(r.hazard_factors) && r.hazard_factors.length > 0 && (
                            <div className="flex gap-1 flex-wrap mt-0.5">
                              {r.hazard_factors.slice(0, 3).map((hf: string) => (
                                <Badge key={hf} variant="outline" className="text-[9px] h-4 px-1">{hf}</Badge>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {r.report_url && (
                              <a
                                href={r.report_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline inline-flex items-center gap-0.5 px-1.5"
                                title="건강진단 결과지 원본 보기"
                              >
                                <ExternalLink className="h-3.5 w-3.5" /> 결과지
                              </a>
                            )}
                            <Button size="icon" variant="ghost" onClick={() => openEdit(r)} title="수정"><Pencil className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" onClick={() => onDelete(r)} title="삭제"><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filtered.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      {list.length === 0
                        ? <>등록된 건강진단 기록이 없습니다. <Button variant="link" className="p-0 h-auto" onClick={() => setOpenNew(true)}>신규 등록</Button></>
                        : "검색 결과가 없습니다."}
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={openNew} onOpenChange={setOpenNew}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingRow ? "건강진단 수정" : "건강진단 등록"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-primary/25 bg-primary/5 p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-xs">
                  <p className="font-medium text-foreground flex items-center gap-1">
                    <Sparkles className="h-3.5 w-3.5 text-primary" /> 결과지 올리고 AI 자동 판독
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    배치전·일반·특수 결과지(사진/PDF)를 올리면 등급·실시일·차기일·제한사항을 자동 입력합니다.
                  </p>
                </div>
                <label className="cursor-pointer shrink-0">
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*,application/pdf"
                    disabled={ocrBusy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleSingleReportOcr(f);
                      e.target.value = "";
                    }}
                  />
                  <Button asChild type="button" size="sm" variant="default" className="h-7 text-xs gap-1" disabled={ocrBusy}>
                    <span>
                      {ocrBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      {ocrBusy ? "AI 판독 중…" : "결과지 업로드"}
                    </span>
                  </Button>
                </label>
              </div>
              {ocrSummary && (
                <p className="text-[11px] text-primary bg-background/80 rounded border px-2 py-1">{ocrSummary}</p>
              )}
              {form.report_url && (
                <a href={form.report_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary underline inline-flex items-center gap-1">
                  <ExternalLink className="h-3 w-3" /> 업로드된 결과지 원본 보기
                </a>
              )}
            </div>
            <div>
              <Label>근로자 *</Label>
              <Select value={form.worker_id || ""} onValueChange={v => setForm({ ...form, worker_id: v })}>
                <SelectTrigger><SelectValue placeholder="근로자 선택" /></SelectTrigger>
                <SelectContent>{workers.map(w => <SelectItem key={w.id} value={w.id}>{w.name} ({w.company_name})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>종류 *</Label>
                <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>결과</Label>
                <Select value={form.result} onValueChange={v => setForm({ ...form, result: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{RESULTS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>실시일</Label><Input type="date" value={form.conducted_date || ""} onChange={e => setForm({ ...form, conducted_date: e.target.value })} /></div>
              <div><Label>차회 기한</Label><Input type="date" value={form.next_due_date || ""} onChange={e => setForm({ ...form, next_due_date: e.target.value })} /></div>
              <div className="col-span-2"><Label>검진기관</Label><Input value={form.institution || ""} onChange={e => setForm({ ...form, institution: e.target.value })} /></div>
              <div className="col-span-2"><Label>작업 제한 사항</Label><Input value={form.restrictions || ""} onChange={e => setForm({ ...form, restrictions: e.target.value })} /></div>
              {Array.isArray(form.hazard_factors) && form.hazard_factors.length > 0 && (
                <div className="col-span-2 flex items-center gap-1 flex-wrap">
                  <span className="text-[11px] text-muted-foreground mr-1">추출 유해인자:</span>
                  {form.hazard_factors.map((hf: string) => (
                    <Badge key={hf} variant="outline" className="text-[10px]">{hf}</Badge>
                  ))}
                </div>
              )}
              <div className="col-span-2 flex items-center gap-2 rounded border bg-muted/20 px-2.5 py-2">
                <Checkbox
                  id="hc-daily-log"
                  checked={enableDailyLog}
                  onCheckedChange={(v) => setEnableDailyLog(!!v)}
                />
                <label htmlFor="hc-daily-log" className="text-xs cursor-pointer select-none">
                  이 근로자를 <b>일일 건강상태 체크 대상자</b>로 함께 지정 (유소견·요관찰·작업제한 권장)
                </label>
              </div>
              <div className="col-span-2"><Label>비고</Label><Input value={form.notes || ""} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpenNew(false)}>취소</Button><Button onClick={submit}>{editingRow ? "저장" : "등록"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <HealthCheckupBulkImportDialog
        open={openBulk}
        onOpenChange={setOpenBulk}
        projectId={projectId}
        workers={workers}
        existingCheckups={list}
        onImported={load}
      />

      <HealthCheckupBatchOcrDialog
        open={openBatchOcr}
        onOpenChange={setOpenBatchOcr}
        projectId={projectId}
        workers={workers}
        onSaved={load}
      />
    </div>
  );
}
