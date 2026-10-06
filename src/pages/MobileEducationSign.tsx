import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useMobileSubpageBack } from "@/lib/mobileNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ResponsiveSignaturePad, { type ResponsiveSignaturePadHandle } from "@/components/ResponsiveSignaturePad";
import { REQ_TYPE_LABELS } from "@/hooks/useWorker";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

type Row = {
  session_id: string;
  course_name: string;
  education_type: string;
  held_on: string;
  hours: number;
  place: string | null;
  outline: string;
  instructor: string | null;
  signed: boolean;
};

const db = supabase as any;

export default function MobileEducationSign() {
  const [params] = useSearchParams();
  const onBack = useMobileSubpageBack("/app/worker/tasks");
  const sessionParam = params.get("session") || "";
  const padRef = useRef<ResponsiveSignaturePadHandle>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [active, setActive] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await db.rpc("list_my_open_education_sessions");
    if (error) toast.error(error.message);
    const list = (data || []) as Row[];
    setRows(list);
    const picked = sessionParam ? list.find((r) => r.session_id === sessionParam) || null : null;
    setActive(picked);
    setLoading(false);
  };

  useEffect(() => { load(); }, [sessionParam]);

  const sign = async () => {
    if (!active) return;
    if (padRef.current?.isEmpty()) {
      toast.error("서명을 해 주세요");
      return;
    }
    const signature = padRef.current?.toDataURL() || "";
    setSaving(true);
    const { data, error } = await db.rpc("sign_education_session", {
      _session_id: active.session_id,
      _signature: signature,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data?.error) {
      const msg: Record<string, string> = {
        NOT_INVITED: "이 교육의 참석 명단에 없습니다",
        SESSION_CLOSED: "이미 마감된 교육입니다",
        NO_WORKER: "이 전화번호의 근로자 등록이 없습니다",
        SIGNATURE_REQUIRED: "서명을 해 주세요",
      };
      toast.error(msg[data.error] || "서명을 저장하지 못했습니다");
      return;
    }
    toast.success("서명했습니다");
    load();
  };

  return (
    <div className="p-4 space-y-3 max-w-md mx-auto">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> 뒤로
      </button>
      <h1 className="text-lg font-bold">교육 서명</h1>
      {loading && <p className="text-sm text-muted-foreground">불러오는 중…</p>}
      {!loading && sessionParam && !rows.some((r) => r.session_id === sessionParam) && (
        <p className="text-sm text-muted-foreground">이 교육의 참석 명단에 없습니다.</p>
      )}
      {!loading && !active && rows.length === 0 && !sessionParam && (
        <p className="text-sm text-muted-foreground">서명할 교육이 없습니다. 안전관리자가 참석 명단에 넣은 뒤 열립니다.</p>
      )}
      {!loading && !active && rows.map((r) => (
        <button key={r.session_id} type="button" onClick={() => setActive(r)} className="w-full text-left">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{r.course_name}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {REQ_TYPE_LABELS[r.education_type] || r.education_type} · {r.held_on} · {r.signed ? "서명함" : "서명 전"}
            </CardContent>
          </Card>
        </button>
      ))}
      {active && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{active.course_name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {REQ_TYPE_LABELS[active.education_type] || active.education_type} · {active.held_on} · {active.hours}시간
              {active.place ? ` · ${active.place}` : ""}
              {active.instructor ? ` · ${active.instructor}` : ""}
            </p>
            <p className="text-sm whitespace-pre-wrap">{active.outline}</p>
            {active.signed ? (
              <p className="text-sm">이미 서명했습니다.</p>
            ) : (
              <>
                <ResponsiveSignaturePad ref={padRef} />
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => padRef.current?.clear()}>지우기</Button>
                  <Button onClick={sign} disabled={saving}>{saving ? "저장 중…" : "서명"}</Button>
                </div>
              </>
            )}
            <Button variant="ghost" onClick={() => setActive(null)}>목록</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
