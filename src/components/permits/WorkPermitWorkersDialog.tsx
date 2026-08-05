import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users, Search, UserCheck } from "lucide-react";
import { toast } from "sonner";
import {
  buildPersonnelCountPatch,
  filterPermitAssignableWorkers,
} from "@/lib/permitWorkers";
import { syncPermitCrewToTbm } from "@/lib/syncPermitCrewToTbm";

type Props = {
  permit: any | null;
  projectId: string;
  open: boolean;
  onClose: () => void;
  /** Called after successful save with new assigned count */
  onSaved?: (assignedCount: number) => void;
};

export default function WorkPermitWorkersDialog({
  permit,
  projectId,
  open,
  onClose,
  onSaved,
}: Props) {
  const [workers, setWorkers] = useState<any[]>([]);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [initialAssigned, setInitialAssigned] = useState<Set<string>>(new Set());
  const [onSiteIds, setOnSiteIds] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const permitCompanyId: string | null = permit?.company_id || null;

  useEffect(() => {
    if (!open || !permit || !projectId) return;
    (async () => {
      setLoading(true);
      setQ("");
      const today = new Date().toISOString().slice(0, 10);
      const companyId = (permit as { company_id?: string | null }).company_id || null;

      let companyLabel: string | null = null;
      if (companyId) {
        const { data: cRow } = await supabase
          .from("companies")
          .select("name")
          .eq("id", companyId)
          .maybeSingle();
        companyLabel = (cRow as { name?: string } | null)?.name || null;
      }
      setCompanyName(companyLabel);

      // Scope query to permit company (+ orphans for label match). No company → empty list.
      let workersQ: any = supabase
        .from("workers")
        .select("id, name, phone, company_name, company_id")
        .eq("project_id", projectId)
        .eq("is_active", true)
        .order("name");
      if (companyId) {
        workersQ = workersQ.or(`company_id.eq.${companyId},company_id.is.null`);
      } else {
        workersQ = workersQ.eq("company_id", "00000000-0000-0000-0000-000000000000");
      }

      const [{ data: ws }, { data: wpw }, { data: logs }] = await Promise.all([
        workersQ,
        supabase
          .from("work_permit_workers" as any)
          .select("worker_id")
          .eq("work_permit_id", permit.id),
        supabase
          .from("worker_entry_logs" as any)
          .select("worker_id, entry_at, exit_at")
          .eq("project_id", projectId)
          .gte("entry_at", `${today}T00:00:00`)
          .lte("entry_at", `${today}T23:59:59`),
      ]);

      const scoped = filterPermitAssignableWorkers(ws || [], companyId, companyLabel);
      setWorkers(scoped);

      const ids = new Set((wpw || []).map((r: any) => r.worker_id as string));
      setAssigned(ids);
      setInitialAssigned(new Set(ids));
      const site = new Set<string>();
      const scopedIds = new Set(scoped.map((w) => w.id));
      for (const row of (logs as any[]) || []) {
        // Only count on-site workers that belong to this permit's company
        if (row.worker_id && !row.exit_at && scopedIds.has(row.worker_id)) {
          site.add(row.worker_id);
        }
      }
      setOnSiteIds(site);
      setLoading(false);
    })();
  }, [open, permit, projectId]);

  const toggle = (id: string) => {
    const next = new Set(assigned);
    next.has(id) ? next.delete(id) : next.add(id);
    setAssigned(next);
  };

  const selectOnSite = () => {
    if (onSiteIds.size === 0) {
      toast.message("오늘 출근(미퇴근)한 자사 근로자가 없습니다.");
      return;
    }
    const next = new Set(assigned);
    onSiteIds.forEach((id) => next.add(id));
    setAssigned(next);
    toast.success(`자사 출근자 ${onSiteIds.size}명 선택에 반영`);
  };

  const save = async () => {
    if (!permit) return;
    setSaving(true);
    const allowed = new Set(workers.map((w) => w.id));
    // Never persist a selection outside permit company (stale / race)
    const safeAssigned = new Set([...assigned].filter((id) => allowed.has(id) || initialAssigned.has(id)));
    // Drop initial assignments that are no longer in allowed only if user unchecked —
    // keep initialAssigned removals as usual
    const toAdd = [...safeAssigned].filter((id) => !initialAssigned.has(id) && allowed.has(id));
    const toRemove = [...initialAssigned].filter((id) => !safeAssigned.has(id));

    if (toAdd.length > 0) {
      const rows = toAdd.map((worker_id) => ({
        work_permit_id: permit.id,
        worker_id,
        project_id: projectId,
        notification_status: "pending",
      }));
      const { error } = await supabase.from("work_permit_workers" as any).insert(rows);
      if (error) {
        toast.error("배정 실패: " + error.message);
        setSaving(false);
        return;
      }
    }
    if (toRemove.length > 0) {
      const { error } = await supabase
        .from("work_permit_workers" as any)
        .delete()
        .eq("work_permit_id", permit.id)
        .in("worker_id", toRemove);
      if (error) {
        toast.error("해제 실패: " + error.message);
        setSaving(false);
        return;
      }
    }

    const patch = buildPersonnelCountPatch(permit.form_data, safeAssigned.size);
    const { error: countErr } = await supabase
      .from("work_permits" as any)
      .update(patch as any)
      .eq("id", permit.id);
    if (countErr) {
      toast.error("작업인원 동기화 실패: " + countErr.message);
      setSaving(false);
      return;
    }

    // Linked TBM: keep participant roster in sync with permit crew
    if (permit.tbm_session_id) {
      const sync = await syncPermitCrewToTbm({
        permitId: permit.id,
        tbmSessionId: permit.tbm_session_id,
      });
      if (!sync.ok) {
        toast.error("TBM 참석자 동기화 실패: " + sync.error);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    toast.success(`근로자 ${safeAssigned.size}명 배정 · 작업인원 반영`);
    onSaved?.(safeAssigned.size);
    onClose();
  };

  const filtered = useMemo(
    () =>
      workers.filter(
        (w) =>
          !q ||
          w.name?.includes(q) ||
          w.phone?.includes(q) ||
          w.company_name?.includes(q),
      ),
    [workers, q],
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" /> 근로자 배정
            <Badge variant="secondary">{assigned.size}명 선택</Badge>
            {onSiteIds.size > 0 && (
              <Badge variant="outline" className="text-[10px]">
                출근 {onSiteIds.size}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            {permit?.work_description} · {permit?.permit_date}
            <span className="block text-xs mt-0.5">
              {permitCompanyId ? (
                <>
                  <b className="text-foreground">{companyName || "자사"}</b> 근로자만 표시합니다.
                  저장 시 작업인원이 선택 인원과 맞춰집니다.
                </>
              ) : (
                <span className="text-destructive">
                  허가서에 소속 회사가 없어 배정할 수 없습니다. 허가서 회사 정보를 확인하세요.
                </span>
              )}
            </span>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="이름·전화 검색"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                disabled={!permitCompanyId}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={selectOnSite}
              disabled={loading || onSiteIds.size === 0 || !permitCompanyId}
              title="오늘 출근·미퇴근 자사 근로자 선택"
            >
              <UserCheck className="h-4 w-4 mr-1" />
              출근자
            </Button>
          </div>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto border rounded divide-y">
              {!permitCompanyId ? (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  허가서 소속 회사가 없습니다.
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  이 회사로 등록된 근로자가 없습니다.
                </div>
              ) : (
                filtered.map((w) => (
                  <label
                    key={w.id}
                    className="flex items-center gap-3 p-2 hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={assigned.has(w.id)}
                      onCheckedChange={() => toggle(w.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium flex items-center gap-1.5">
                        {w.name}
                        {onSiteIds.has(w.id) && (
                          <Badge variant="secondary" className="text-[9px] px-1 py-0">
                            출근
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {w.company_name || companyName || "-"} · {w.phone}
                      </div>
                    </div>
                  </label>
                ))
              )}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              취소
            </Button>
            <Button onClick={save} disabled={saving || loading || !permitCompanyId}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              저장
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
