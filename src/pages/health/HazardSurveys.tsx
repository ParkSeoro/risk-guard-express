import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToastError } from "@/hooks/useToastError";
import { toast } from "sonner";
import { Plus, ClipboardList, Copy } from "lucide-react";
import { useGlobalProjectAccess } from '@/components/AppLayout';

const TYPES = ["근골격계", "뇌심혈관", "직무스트레스", "감정노동"];

export default function HazardSurveys() {
  const handle = useToastError();
  const { selectedProject: projectId, applyCompanyFilter, userCompanyId } = useGlobalProjectAccess();
  const [list, setList] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ type: "근골격계", survey_date: new Date().toISOString().slice(0, 10) });
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      let q = supabase.from("hazard_surveys").select("*").eq("project_id", projectId).eq("is_deleted", false).order("survey_date", { ascending: false });
      q = applyCompanyFilter(q);
      const { data } = await q;
      setList(data || []);
    } catch (e) { handle(e, "유해요인조사 조회"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [projectId, userCompanyId]);

  const submit = async () => {
    if (!projectId || !form.title || !form.survey_date) { toast.error("제목·실시일 필수"); return; }
    try {
      const token = crypto.randomUUID().replace(/-/g, "");
      const next = new Date(form.survey_date); next.setFullYear(next.getFullYear() + 3);
      const { error } = await supabase.from("hazard_surveys").insert({
        project_id: projectId,
        type: form.type,
        title: form.title,
        survey_date: form.survey_date,
        target_count: form.target_count ? Number(form.target_count) : 0,
        qr_token: token,
        next_due_date: next.toISOString().slice(0, 10),
      });
      if (error) throw error;
      toast.success("설문이 생성되었습니다");
      setOpen(false); setForm({ type: "근골격계", survey_date: new Date().toISOString().slice(0, 10) });
      await load();
    } catch (e) { handle(e, "유해요인조사 생성"); }
  };

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/health/survey/${token}`;
    navigator.clipboard.writeText(url);
    toast.success("설문 링크가 복사되었습니다");
  };

  if (!projectId) return <div className="p-6 text-muted-foreground">프로젝트를 선택해주세요.</div>;

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardList className="h-6 w-6" />유해요인조사</h1>
          <p className="text-sm text-muted-foreground mt-1">근골격계·뇌심혈관·직무스트레스 조사 (산안법 시행규칙 제657조, 3년 주기)</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />조사 생성</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">조사 목록 ({list.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? <div className="text-sm text-muted-foreground">로딩 중…</div> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>실시일</TableHead><TableHead>유형</TableHead><TableHead>제목</TableHead>
                  <TableHead>응답</TableHead><TableHead>고위험</TableHead><TableHead>차회</TableHead><TableHead>링크</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {list.map(r => (
                    <TableRow key={r.id}>
                      <TableCell>{r.survey_date}</TableCell>
                      <TableCell><Badge variant="outline">{r.type}</Badge></TableCell>
                      <TableCell>{r.title}</TableCell>
                      <TableCell>{r.response_count}/{r.target_count}</TableCell>
                      <TableCell>{r.high_risk_count > 0 ? <Badge variant="destructive">{r.high_risk_count}</Badge> : "-"}</TableCell>
                      <TableCell className="text-xs">{r.next_due_date || "-"}</TableCell>
                      <TableCell>
                        {r.qr_token && (
                          <Button size="sm" variant="outline" onClick={() => copyLink(r.qr_token)}>
                            <Copy className="h-3 w-3 mr-1" />복사
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {list.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">생성된 조사가 없습니다.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>유해요인조사 생성</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>유형</Label>
              <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>실시일</Label><Input type="date" value={form.survey_date} onChange={e => setForm({ ...form, survey_date: e.target.value })} /></div>
            <div className="col-span-2"><Label>제목</Label><Input value={form.title || ""} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="2026년 상반기 근골격계 유해요인조사" /></div>
            <div><Label>대상 인원</Label><Input type="number" value={form.target_count || ""} onChange={e => setForm({ ...form, target_count: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>취소</Button><Button onClick={submit}>생성</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
