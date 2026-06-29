import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectAccess } from "@/hooks/useProjectAccess";
import { useAuth } from "@/contexts/AuthContext";
import { useAuditLog } from "@/hooks/useAuditLog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserCheck, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { differenceInCalendarDays, startOfDay, addDays } from "date-fns";

type Row = {
  id: string; project_id: string; full_name: string; role_type: string;
  company_id: string | null; appointed_at: string; ended_at: string | null;
  reason: string | null; reported_to_authority_at: string | null;
  authority_doc_no: string | null; evidence_url: string | null; is_deleted: boolean;
};
const ROLES = ['안전보건관리책임자','관리감독자','안전관리자','보건관리자','산업보건의','명예산업안전감독관'];
type StatusFilter = 'all' | 'active' | 'ended' | 'unreported';

function reportBadge(appointed_at: string, reported_to_authority_at: string | null) {
  if (reported_to_authority_at) return <Badge variant="outline" className="text-[10px] h-4">신고완료</Badge>;
  const due = addDays(new Date(appointed_at), 14);
  const diff = differenceInCalendarDays(due, startOfDay(new Date()));
  if (diff < 0) return <Badge variant="destructive" className="text-[10px] h-4">D+{Math.abs(diff)} 초과</Badge>;
  if (diff === 0) return <Badge className="text-[10px] h-4 bg-orange-500 hover:bg-orange-500">D-Day</Badge>;
  if (diff <= 3) return <Badge variant="outline" className="text-[10px] h-4 text-orange-600 border-orange-300">D-{diff}</Badge>;
  return <Badge variant="outline" className="text-[10px] h-4 text-muted-foreground">D-{diff}</Badge>;
}

export default function SafetyAppointments() {
  const { selectedProject: projectId, canEdit, canDelete } = useProjectAccess();
  const { user } = useAuth();
  const { log } = useAuditLog();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [form, setForm] = useState({
    full_name: "", role_type: "안전관리자", appointed_at: new Date().toISOString().slice(0,10),
    ended_at: "", reason: "", reported_to_authority_at: "", authority_doc_no: "", evidence_url: "",
  });

  async function load() {
    if (!projectId) return;
    setLoading(true);
    const { data, error } = await supabase.from("safety_appointments").select("*")
      .eq("project_id", projectId).eq("is_deleted", false).order("appointed_at", { ascending: false });
    if (error) toast.error(error.message);
    setRows((data as Row[]) || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, [projectId]);

  function openCreate() {
    setEditing(null);
    setForm({ full_name: "", role_type: "안전관리자", appointed_at: new Date().toISOString().slice(0,10), ended_at: "", reason: "", reported_to_authority_at: "", authority_doc_no: "", evidence_url: "" });
    setOpen(true);
  }
  function openEdit(r: Row) {
    setEditing(r);
    setForm({
      full_name: r.full_name, role_type: r.role_type, appointed_at: r.appointed_at,
      ended_at: r.ended_at || "", reason: r.reason || "",
      reported_to_authority_at: r.reported_to_authority_at ? r.reported_to_authority_at.slice(0,10) : "",
      authority_doc_no: r.authority_doc_no || "", evidence_url: r.evidence_url || "",
    });
    setOpen(true);
  }
  async function save() {
    if (!projectId) return;
    if (!form.full_name.trim()) { toast.error("성명을 입력하세요"); return; }
    const payload: any = {
      project_id: projectId, full_name: form.full_name.trim(), role_type: form.role_type,
      appointed_at: form.appointed_at, ended_at: form.ended_at || null,
      reason: form.reason || null,
      reported_to_authority_at: form.reported_to_authority_at || null,
      authority_doc_no: form.authority_doc_no || null,
      evidence_url: form.evidence_url || null,
    };
    const { error, data } = editing
      ? await supabase.from("safety_appointments").update(payload).eq("id", editing.id).select().single()
      : await supabase.from("safety_appointments").insert(payload).select().single();
    if (error) { toast.error(error.message); return; }
    await log(editing ? '수정' : '등록', 'safety_appointment', (data as any)?.id || editing?.id || '', projectId, { full_name: payload.full_name, role_type: payload.role_type });
    toast.success(editing ? "수정" : "등록");
    setOpen(false); load();
  }

  async function handleDelete(r: Row) {
    const reason = prompt('삭제 사유를 입력하세요. (필수)');
    if (!reason || !reason.trim()) return;
    const { error } = await supabase.from("safety_appointments").update({
      is_deleted: true, deleted_at: new Date().toISOString(), deleted_reason: reason, deleted_by: user?.id || null,
    } as any).eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    await log('삭제', 'safety_appointment', r.id, projectId || undefined, { reason, full_name: r.full_name });
    toast.success("삭제되었습니다");
    setRows(prev => prev.filter(x => x.id !== r.id));
  }

  const today = new Date().toISOString().slice(0,10);
  const isActive = (r: Row) => !r.ended_at || r.ended_at > today;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (q && !`${r.full_name} ${r.authority_doc_no || ''}`.toLowerCase().includes(q)) return false;
      if (roleFilter !== 'all' && r.role_type !== roleFilter) return false;
      if (statusFilter === 'active' && !isActive(r)) return false;
      if (statusFilter === 'ended' && isActive(r)) return false;
      if (statusFilter === 'unreported' && r.reported_to_authority_at) return false;
      return true;
    });
  }, [rows, search, roleFilter, statusFilter]);

  const active = rows.filter(isActive);
  const hasManager = active.some(r => r.role_type === '안전관리자');
  const unreportedCount = rows.filter(r => !r.reported_to_authority_at && isActive(r)).length;

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><UserCheck className="text-primary" /> 안전관리자 선임이력</h1>
          <p className="text-sm text-muted-foreground">산안법 §15~17 — 선임 후 14일 내 노동청 신고 의무</p>
        </div>
        {canEdit('legal_duty') && <Button onClick={openCreate}><Plus className="size-4 mr-1" /> 선임 등록</Button>}
      </header>

      {!hasManager && !loading && (
        <Card className="border-destructive">
          <CardContent className="p-3 text-sm text-destructive">⚠️ 현재 활성 안전관리자가 등록되어 있지 않습니다. 산안법 §17에 따라 선임 의무가 있을 수 있습니다.</CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="성명/문서번호 검색..." className="h-8 pl-7 text-xs" />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">전체 직위</SelectItem>
            {ROLES.map(r => <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={v => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">전체</SelectItem>
            <SelectItem value="active" className="text-xs">활성 ({active.length})</SelectItem>
            <SelectItem value="ended" className="text-xs">종료</SelectItem>
            <SelectItem value="unreported" className="text-xs">미신고 ({unreportedCount})</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">선임 이력 ({filtered.length}/{rows.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">표시할 선임 기록이 없습니다.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr className="text-left">
                  <th className="p-2">성명</th><th className="p-2">직위</th>
                  <th className="p-2">선임일</th><th className="p-2">해임일</th>
                  <th className="p-2">노동청 신고</th><th className="p-2">문서번호</th>
                  <th className="p-2">상태</th><th className="p-2"></th>
                </tr></thead>
                <tbody>
                  {filtered.map(r => {
                    const active = isActive(r);
                    return (
                      <tr key={r.id} className="border-t hover:bg-muted/30">
                        <td className="p-2 font-medium">{r.full_name}</td>
                        <td className="p-2"><Badge variant="outline">{r.role_type}</Badge></td>
                        <td className="p-2 whitespace-nowrap">{r.appointed_at}</td>
                        <td className="p-2 whitespace-nowrap">{r.ended_at || "-"}</td>
                        <td className="p-2 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            {r.reported_to_authority_at ? <span className="text-xs">{r.reported_to_authority_at.slice(0,10)}</span> : <span className="text-destructive text-xs">미신고</span>}
                            {active && reportBadge(r.appointed_at, r.reported_to_authority_at)}
                          </div>
                        </td>
                        <td className="p-2">{r.authority_doc_no || "-"}</td>
                        <td className="p-2"><Badge variant={active ? "default" : "secondary"}>{active ? "활성" : "종료"}</Badge></td>
                        <td className="p-2 whitespace-nowrap">
                          {canEdit('legal_duty') && <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>수정</Button>}
                          {canDelete('legal_duty') && (
                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(r)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
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
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{editing ? "선임 이력 수정" : "선임 등록"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>성명</Label><Input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></div>
              <div><Label>직위</Label>
                <Select value={form.role_type} onValueChange={v => setForm({ ...form, role_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>선임일</Label><Input type="date" value={form.appointed_at} onChange={e => setForm({ ...form, appointed_at: e.target.value })} /></div>
              <div><Label>해임일 (있을 시)</Label><Input type="date" value={form.ended_at} onChange={e => setForm({ ...form, ended_at: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>노동청 신고일 (선임일 +14일 이내)</Label><Input type="date" value={form.reported_to_authority_at} onChange={e => setForm({ ...form, reported_to_authority_at: e.target.value })} /></div>
              <div><Label>신고 문서번호</Label><Input value={form.authority_doc_no} onChange={e => setForm({ ...form, authority_doc_no: e.target.value })} /></div>
            </div>
            <div><Label>증빙 URL</Label><Input value={form.evidence_url} onChange={e => setForm({ ...form, evidence_url: e.target.value })} /></div>
            <div><Label>비고/사유</Label><Textarea rows={2} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></div>
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
