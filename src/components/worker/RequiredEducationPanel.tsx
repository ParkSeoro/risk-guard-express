import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GraduationCap, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { REQ_TYPE_LABELS } from "@/hooks/useWorker";

type Row = {
  education_type: string;
  required_hours: number;
  interval_months: number;
  first_due_days: number;
  legal_basis: string;
  next_due_at?: string | null;
  last_completed_at?: string | null;
  status?: "ok" | "due_soon" | "overdue" | "missing";
};

type Props =
  | { mode: "preview"; projectId: string; jobType: string; workerId?: never }
  | { mode: "worker"; workerId: string; projectId?: never; jobType?: never };

const statusBadge = (s?: string) => {
  if (s === "ok") return <Badge variant="outline" className="bg-success/10 text-success border-success/40 gap-1"><CheckCircle2 className="h-3 w-3" />이수</Badge>;
  if (s === "due_soon") return <Badge className="bg-warning text-warning-foreground gap-1"><Clock className="h-3 w-3" />임박</Badge>;
  if (s === "overdue") return <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" />초과</Badge>;
  if (s === "missing") return <Badge variant="secondary">미이수</Badge>;
  return <Badge variant="outline">예정</Badge>;
};

export default function RequiredEducationPanel(props: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let data: any = null, error: any = null;
      if (props.mode === "preview") {
        if (!props.projectId || !props.jobType) { setRows([]); setLoading(false); return; }
        ({ data, error } = await supabase.rpc("preview_required_education", {
          _project_id: props.projectId, _job_type: props.jobType,
        } as any));
      } else {
        ({ data, error } = await supabase.rpc("compute_worker_required_education", {
          _worker_id: props.workerId,
        } as any));
      }
      if (!cancelled) {
        if (error) console.warn("required education load", error);
        setRows((data || []) as Row[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [props.mode === "preview" ? props.projectId : props.workerId,
      props.mode === "preview" ? props.jobType : ""]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <GraduationCap className="h-4 w-4 text-primary" />
          {props.mode === "preview" ? "이 직종에 필요한 법정교육" : "필수 법정교육 현황"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && <div className="text-xs text-muted-foreground">불러오는 중…</div>}
        {!loading && rows.length === 0 && (
          <div className="text-xs text-muted-foreground">매핑된 법정교육이 없습니다.</div>
        )}
        {rows.length > 0 && (
          <div className="text-xs space-y-1.5">
            {rows.map((r, i) => (
              <div key={i} className="flex items-start justify-between gap-2 border-b pb-1.5 last:border-0">
                <div className="min-w-0">
                  <div className="font-medium text-sm">{REQ_TYPE_LABELS[r.education_type] || r.education_type}</div>
                  <div className="text-muted-foreground truncate">
                    {Number(r.required_hours)}시간 · 주기 {r.interval_months}개월
                    {r.legal_basis && <> · {r.legal_basis}</>}
                  </div>
                  {props.mode === "worker" && (
                    <div className="text-muted-foreground">
                      예정일 {r.next_due_at || "-"}
                      {r.last_completed_at && <> · 최근이수 {r.last_completed_at}</>}
                    </div>
                  )}
                </div>
                {props.mode === "worker" ? statusBadge(r.status) :
                  <Badge variant="outline">필수</Badge>}
              </div>
            ))}
          </div>
        )}
        {props.mode === "preview" && rows.length > 0 && (
          <div className="text-[11px] text-muted-foreground pt-1">
            * 등록 완료 시 해당 항목이 자동으로 의무 일정에 등록됩니다.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
