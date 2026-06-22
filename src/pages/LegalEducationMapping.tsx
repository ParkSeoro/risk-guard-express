import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { GraduationCap, Plus, Trash2 } from "lucide-react";
import { JOB_TYPE_LABELS, REQ_TYPE_LABELS } from "@/hooks/useWorker";

export default function LegalEducationMapping() {
  const [projectId] = useState(() => localStorage.getItem("selectedProjectId") || localStorage.getItem("currentProjectId") || "");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newRow, setNewRow] = useState({ job_type: "general", education_type: "regular", interval_months: 3, first_due_days: 90, required_hours: 6, legal_basis: "" });

  const load = async () => {
    setLoading(true);
    const q = supabase.from("worker_legal_education_mapping").select("*").eq("is_deleted", false).order("is_system_default", { ascending: false }).order("job_type");
    const { data, error } = projectId
      ? await q.or(`is_system_default.eq.true,project_id.eq.${projectId}`)
      : await q.eq("is_system_default", true);
    if (error) toast.error(error.message);
    setItems(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [projectId]);

  const addOverride = async () => {
    if (!projectId) { toast.error("프로젝트를 먼저 선택하세요"); return; }
    const { error } = await supabase.from("worker_legal_education_mapping").insert({ ...newRow, project_id: projectId, is_system_default: false });
    if (error) { toast.error(error.message); return; }
    toast.success("프로젝트 매핑 추가됨");
    load();
  };

  const removeRow = async (row: any) => {
    if (row.is_system_default) { toast.error("시스템 기본 항목은 삭제할 수 없습니다 (프로젝트 오버라이드로 덮어쓰세요)"); return; }
    const { error } = await supabase.from("worker_legal_education_mapping").update({ is_deleted: true }).eq("id", row.id);
    if (error) { toast.error(error.message); return; }
    toast.success("삭제됨"); load();
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-2xl font-bold flex items-center gap-2"><GraduationCap className="h-6 w-6" /> 법정 교육 매핑</h1>
      <p className="text-sm text-muted-foreground">직종별로 어떤 법정 교육/건진이 언제 필요한지 정의합니다. 시스템 기본은 산안법 기준이며, 프로젝트별로 추가/오버라이드할 수 있습니다.</p>

      <Card>
        <CardHeader><CardTitle className="text-base">프로젝트 매핑 추가</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-6 gap-2 text-sm">
          <Select value={newRow.job_type} onValueChange={(v) => setNewRow({ ...newRow, job_type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(JOB_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={newRow.education_type} onValueChange={(v) => setNewRow({ ...newRow, education_type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(REQ_TYPE_LABELS).filter(([k]) => !["age65", "health_d"].includes(k)).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="number" placeholder="주기(개월)" value={newRow.interval_months} onChange={(e) => setNewRow({ ...newRow, interval_months: Number(e.target.value) })} />
          <Input type="number" placeholder="최초 마감(일)" value={newRow.first_due_days} onChange={(e) => setNewRow({ ...newRow, first_due_days: Number(e.target.value) })} />
          <Input type="number" placeholder="시간" value={newRow.required_hours} onChange={(e) => setNewRow({ ...newRow, required_hours: Number(e.target.value) })} />
          <Button onClick={addOverride}><Plus className="h-4 w-4 mr-1" />추가</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">현재 매핑 ({items.length}건)</CardTitle></CardHeader>
        <CardContent>
          {loading ? "로딩 중..." : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="py-2">유형</th><th>직종</th><th>교육/건진</th><th>주기(월)</th><th>최초(일)</th><th>시간</th><th>법적 근거</th><th></th></tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-2">{r.is_system_default ? <Badge variant="secondary">시스템</Badge> : <Badge>프로젝트</Badge>}</td>
                    <td>{JOB_TYPE_LABELS[r.job_type] || r.job_type}</td>
                    <td>{REQ_TYPE_LABELS[r.education_type] || r.education_type}</td>
                    <td>{r.interval_months}</td>
                    <td>{r.first_due_days}</td>
                    <td>{r.required_hours || "-"}</td>
                    <td className="text-xs text-muted-foreground">{r.legal_basis}</td>
                    <td>{!r.is_system_default && <Button size="sm" variant="ghost" onClick={() => removeRow(r)}><Trash2 className="h-3 w-3" /></Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
