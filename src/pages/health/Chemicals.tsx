import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToastError } from "@/hooks/useToastError";
import { toast } from "sonner";
import { Plus, FlaskConical, FileText } from "lucide-react";

const ACTIVE_PROJECT_KEY = "selectedProjectId";

export default function Chemicals() {
  const handle = useToastError();
  const [list, setList] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const projectId = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_PROJECT_KEY) : null;

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const { data } = await supabase.from("chemicals").select("*").eq("project_id", projectId).eq("is_deleted", false).order("name");
      setList(data || []);
    } catch (e) { handle(e, "화학물질 조회"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [projectId]);

  const submit = async () => {
    if (!projectId || !form.name) { toast.error("물질명은 필수입니다"); return; }
    try {
      let msdsUrl: string | null = null;
      if (form.msdsFile) {
        const path = `chemicals/${projectId}/${Date.now()}_${form.msdsFile.name}`;
        const { error: upErr } = await supabase.storage.from("attachments").upload(path, form.msdsFile);
        if (upErr) throw upErr;
        msdsUrl = supabase.storage.from("attachments").getPublicUrl(path).data.publicUrl;
      }
      const { error } = await supabase.from("chemicals").insert({
        project_id: projectId,
        name: form.name,
        cas_no: form.cas_no || null,
        trade_name: form.trade_name || null,
        hazard_class: form.hazard_class || null,
        is_carcinogen: !!form.is_carcinogen,
        is_reproductive_toxin: !!form.is_reproductive_toxin,
        msds_file_url: msdsUrl,
        storage_location: form.storage_location || null,
        monthly_usage: form.monthly_usage ? Number(form.monthly_usage) : null,
        unit: form.unit || null,
        notes: form.notes || null,
      });
      if (error) throw error;
      toast.success("등록되었습니다");
      setOpen(false); setForm({});
      await load();
    } catch (e) { handle(e, "화학물질 등록"); }
  };

  if (!projectId) return <div className="p-6 text-muted-foreground">프로젝트를 선택해주세요.</div>;

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FlaskConical className="h-6 w-6" />화학물질 / MSDS</h1>
          <p className="text-sm text-muted-foreground mt-1">물질명·CAS·MSDS·발암성·취급량 등록 (산안법 제114조)</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />물질 등록</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">등록된 화학물질 ({list.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? <div className="text-sm text-muted-foreground">로딩 중…</div> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>물질명</TableHead><TableHead>CAS</TableHead><TableHead>유해성</TableHead>
                  <TableHead>월 사용량</TableHead><TableHead>보관위치</TableHead><TableHead>MSDS</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {list.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name} {c.trade_name && <span className="text-xs text-muted-foreground">({c.trade_name})</span>}</TableCell>
                      <TableCell className="text-xs">{c.cas_no || "-"}</TableCell>
                      <TableCell className="space-x-1">
                        {c.is_carcinogen && <Badge variant="destructive">발암성</Badge>}
                        {c.is_reproductive_toxin && <Badge variant="destructive">생식독성</Badge>}
                        {c.hazard_class && <Badge variant="outline">{c.hazard_class}</Badge>}
                      </TableCell>
                      <TableCell>{c.monthly_usage ?? "-"} {c.unit || ""}</TableCell>
                      <TableCell className="text-xs">{c.storage_location || "-"}</TableCell>
                      <TableCell>{c.msds_file_url ? <a href={c.msds_file_url} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1"><FileText className="h-3 w-3" />보기</a> : "-"}</TableCell>
                    </TableRow>
                  ))}
                  {list.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">등록된 화학물질이 없습니다.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>화학물질 등록</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>물질명 *</Label><Input value={form.name || ""} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>CAS No.</Label><Input value={form.cas_no || ""} onChange={e => setForm({ ...form, cas_no: e.target.value })} /></div>
            <div><Label>상품명</Label><Input value={form.trade_name || ""} onChange={e => setForm({ ...form, trade_name: e.target.value })} /></div>
            <div><Label>유해등급</Label><Input value={form.hazard_class || ""} onChange={e => setForm({ ...form, hazard_class: e.target.value })} /></div>
            <div><Label>보관위치</Label><Input value={form.storage_location || ""} onChange={e => setForm({ ...form, storage_location: e.target.value })} /></div>
            <div><Label>월 사용량</Label><Input type="number" value={form.monthly_usage || ""} onChange={e => setForm({ ...form, monthly_usage: e.target.value })} /></div>
            <div><Label>단위</Label><Input value={form.unit || ""} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="kg, L" /></div>
            <div className="col-span-2 flex items-center gap-4">
              <label className="flex items-center gap-2"><Checkbox checked={!!form.is_carcinogen} onCheckedChange={v => setForm({ ...form, is_carcinogen: !!v })} />발암성(1A/1B)</label>
              <label className="flex items-center gap-2"><Checkbox checked={!!form.is_reproductive_toxin} onCheckedChange={v => setForm({ ...form, is_reproductive_toxin: !!v })} />생식독성</label>
            </div>
            <div className="col-span-2"><Label>MSDS 파일 (PDF)</Label><Input type="file" accept="application/pdf,image/*" onChange={e => setForm({ ...form, msdsFile: e.target.files?.[0] })} /></div>
            <div className="col-span-2"><Label>비고</Label><Input value={form.notes || ""} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>취소</Button><Button onClick={submit}>등록</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
