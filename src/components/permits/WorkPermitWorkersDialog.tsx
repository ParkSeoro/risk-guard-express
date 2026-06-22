import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users, Search } from "lucide-react";
import { toast } from "sonner";

type Props = {
  permit: any | null;
  projectId: string;
  open: boolean;
  onClose: () => void;
};

export default function WorkPermitWorkersDialog({ permit, projectId, open, onClose }: Props) {
  const [workers, setWorkers] = useState<any[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [initialAssigned, setInitialAssigned] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !permit || !projectId) return;
    (async () => {
      setLoading(true);
      const [{ data: ws }, { data: wpw }] = await Promise.all([
        supabase.from("workers").select("id, name, phone, company_name, company_id")
          .eq("project_id", projectId).eq("is_active", true).order("name"),
        supabase.from("work_permit_workers" as any).select("worker_id")
          .eq("work_permit_id", permit.id),
      ]);
      setWorkers(ws || []);
      const ids = new Set((wpw || []).map((r: any) => r.worker_id));
      setAssigned(ids);
      setInitialAssigned(new Set(ids));
      setLoading(false);
    })();
  }, [open, permit, projectId]);

  const toggle = (id: string) => {
    const next = new Set(assigned);
    next.has(id) ? next.delete(id) : next.add(id);
    setAssigned(next);
  };

  const save = async () => {
    if (!permit) return;
    setSaving(true);
    const toAdd = [...assigned].filter(id => !initialAssigned.has(id));
    const toRemove = [...initialAssigned].filter(id => !assigned.has(id));

    if (toAdd.length > 0) {
      const rows = toAdd.map(worker_id => ({
        work_permit_id: permit.id,
        worker_id,
        project_id: projectId,
        notification_status: "pending",
      }));
      const { error } = await supabase.from("work_permit_workers" as any).insert(rows);
      if (error) { toast.error("배정 실패: " + error.message); setSaving(false); return; }
    }
    if (toRemove.length > 0) {
      const { error } = await supabase.from("work_permit_workers" as any)
        .delete().eq("work_permit_id", permit.id).in("worker_id", toRemove);
      if (error) { toast.error("해제 실패: " + error.message); setSaving(false); return; }
    }
    setSaving(false);
    toast.success(`근로자 ${assigned.size}명 배정 완료`);
    onClose();
  };

  const filtered = workers.filter(w =>
    !q || w.name?.includes(q) || w.phone?.includes(q) || w.company_name?.includes(q)
  );

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" /> 근로자 배정
            <Badge variant="secondary">{assigned.size}명 선택</Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            {permit?.work_description} · {permit?.permit_date}
          </div>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input className="pl-8" placeholder="이름·전화·회사 검색" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : (
            <div className="max-h-96 overflow-y-auto border rounded divide-y">
              {filtered.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">등록된 근로자가 없습니다.</div>
              ) : filtered.map(w => (
                <label key={w.id} className="flex items-center gap-3 p-2 hover:bg-muted/50 cursor-pointer">
                  <Checkbox checked={assigned.has(w.id)} onCheckedChange={() => toggle(w.id)} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{w.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{w.company_name || "-"} · {w.phone}</div>
                  </div>
                </label>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>취소</Button>
            <Button onClick={save} disabled={saving || loading}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}저장
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
