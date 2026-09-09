import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { AlertTriangle, CheckCircle2, HardHat, Loader2 } from "lucide-react";
import { toast } from "sonner";
import ResponsiveSignaturePad, { ResponsiveSignaturePadHandle } from "@/components/ResponsiveSignaturePad";
import { isClientType } from "@/lib/companyTypes";
import {
  mapPendingManagerTbmSign,
  managerTbmSignPath,
  type PendingManagerTbmSign,
} from "@/lib/managerTbmSign";

function riskList(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Manager-only TBM confirm + sign (not 출퇴근).
 * 시공사 이하 — 서명 시각으로 참여자 명단에 올라간다.
 */
export default function MobileTbmSign() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const sessionParam = params.get("session");
  const { profile } = useAuth();
  const { companyType, loading: accessLoading } = useMobileAccess();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pending, setPending] = useState<PendingManagerTbmSign[]>([]);
  const [current, setCurrent] = useState<PendingManagerTbmSign | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [ppeChecked, setPpeChecked] = useState(false);
  const [understoodChecked, setUnderstoodChecked] = useState(false);
  const sigRef = useRef<ResponsiveSignaturePadHandle | null>(null);

  const ownerBlocked = isClientType(companyType);

  const load = async () => {
    setLoading(true);
    setError("");
    const { data, error: rpcErr } = await supabase.rpc("list_my_pending_tbm_signs" as any);
    if (rpcErr) {
      setError(rpcErr.message || "서명 대상을 불러오지 못했습니다.");
      setPending([]);
      setCurrent(null);
      setLoading(false);
      return;
    }
    const rows = ((data as any[]) || [])
      .map(mapPendingManagerTbmSign)
      .filter((r): r is PendingManagerTbmSign => !!r);
    setPending(rows);
    const picked = (sessionParam && rows.find((r) => r.session_id === sessionParam)) || rows[0] || null;
    if (sessionParam && !picked && rows.length === 0) {
      const { data: s } = await supabase
        .from("tbm_sessions" as any)
        .select("id, project_id, title, tbm_date, location, leader_name, briefing_summary, briefing_risks, company_name, qr_token")
        .eq("id", sessionParam)
        .maybeSingle();
      if (s) {
        const mapped = mapPendingManagerTbmSign({ ...s, session_id: (s as any).id });
        setCurrent(mapped);
        setLoading(false);
        return;
      }
    }
    setCurrent(picked);
    if (!picked && rows.length === 0) {
      setError("오늘 서명할 TBM이 없습니다.");
    }
    setLoading(false);
  };

  useEffect(() => {
    if (accessLoading) return;
    if (ownerBlocked) {
      setLoading(false);
      setError("발주처는 TBM 확인 서명이 필요하지 않습니다.");
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessLoading, ownerBlocked, sessionParam]);

  const handleSubmit = async () => {
    if (!current?.session_id) return;
    if (!confirmed) return toast.error("브리핑 확인 체크가 필요합니다.");
    if (!ppeChecked) return toast.error("PPE(보호구) 착용 확인이 필요합니다.");
    if (!understoodChecked) return toast.error("내용 이해 확인이 필요합니다.");
    if (!sigRef.current || sigRef.current.isEmpty()) return toast.error("전자서명이 필요합니다.");

    setSubmitting(true);
    const signature = sigRef.current.toDataURL("image/png");
    const { data, error: signErr } = await supabase.rpc("manager_sign_tbm_participation" as any, {
      _tbm_session_id: current.session_id,
      _signature_data: signature,
    });
    setSubmitting(false);
    const code = (data as any)?.error || signErr?.message;
    if (signErr || (data as any)?.error) {
      const msg =
        code === "OWNER_NOT_REQUIRED" ? "발주처는 TBM 확인 서명이 필요하지 않습니다."
          : code === "NOT_ELIGIBLE" ? "시공사·협력사 관리자만 서명할 수 있습니다."
            : code === "SIGNATURE_REQUIRED" ? "서명이 필요합니다."
              : code === "SESSION_NOT_FOUND" ? "TBM을 찾을 수 없습니다."
                : code === "ALREADY_SIGNED" ? "이미 서명하셨습니다."
                  : (data as any)?.message || signErr?.message || "서명에 실패했습니다.";
      toast.error(msg);
      return;
    }
    setDone(true);
    toast.success("확인·서명이 등록되었습니다. TBM 명단에 반영됩니다.");
  };

  if (loading || accessLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (ownerBlocked || (error && !current)) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-3">
            <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto" />
            <p className="font-semibold">{error || "서명할 TBM이 없습니다."}</p>
            <Button className="w-full" onClick={() => navigate("/app/worker/today", { replace: true })}>
              오늘 홈으로
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (done) {
    const rest = pending.filter((p) => p.session_id !== current?.session_id);
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <CheckCircle2 className="h-16 w-16 text-emerald-600 mx-auto" />
            <h2 className="text-xl font-bold">서명이 등록되었습니다</h2>
            <p className="text-sm text-muted-foreground">
              {profile?.display_name || "관리자"}님, TBM 확인 서명이 참여자 명단에 반영되었습니다.
            </p>
            {rest.length > 0 ? (
              <Button
                className="w-full"
                onClick={() => {
                  setDone(false);
                  setConfirmed(false);
                  setPpeChecked(false);
                  setUnderstoodChecked(false);
                  sigRef.current?.clear();
                  navigate(managerTbmSignPath(rest[0].session_id), { replace: true });
                }}
              >
                다음 TBM 서명 ({rest.length})
              </Button>
            ) : (
              <Button className="w-full" onClick={() => navigate("/app/worker/today", { replace: true })}>
                오늘 홈으로
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const briefing = current!;
  const risks = riskList(briefing.briefing_risks);

  return (
    <div className="min-h-screen bg-muted/30 p-4 pb-24">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center gap-2 pt-2">
          <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
            <HardHat className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">관리자 TBM 확인·서명</p>
            <p className="font-bold">출퇴근이 아닌 브리핑 확인입니다</p>
          </div>
        </div>

        {pending.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {pending.map((s) => (
              <Button
                key={s.session_id}
                size="sm"
                variant={s.session_id === briefing.session_id ? "default" : "outline"}
                onClick={() => navigate(managerTbmSignPath(s.session_id), { replace: true })}
              >
                {s.title || "TBM"}
              </Button>
            ))}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{briefing.title || "오늘의 TBM"}</CardTitle>
            <div className="text-xs text-muted-foreground space-x-2">
              {briefing.project_name && <span>{briefing.project_name}</span>}
              {briefing.tbm_date && <span>📅 {briefing.tbm_date}</span>}
              {briefing.location && <span>📍 {briefing.location}</span>}
              {briefing.leader_name && <span>👤 {briefing.leader_name}</span>}
              {briefing.company_name && <span>🏢 {briefing.company_name}</span>}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {briefing.briefing_summary && (
              <div>
                <Label className="text-xs">브리핑 요약</Label>
                <div className="mt-1 p-3 rounded-md bg-muted/50 text-sm whitespace-pre-wrap">
                  {briefing.briefing_summary}
                </div>
              </div>
            )}
            {risks.length > 0 && (
              <div>
                <Label className="text-xs">주요 위험요인 및 대책</Label>
                <div className="mt-1 space-y-2">
                  {risks.map((r: any, i: number) => (
                    <div key={i} className="p-3 rounded-md border bg-card">
                      <div className="flex items-start gap-2">
                        <Badge variant={r.grade === "상" ? "destructive" : r.grade === "중" ? "default" : "secondary"}>
                          {r.grade || "중"}
                        </Badge>
                        <div className="flex-1 text-sm">
                          <p className="font-semibold">{r.hazard || r.title}</p>
                          {r.measure && <p className="text-xs text-muted-foreground mt-1">대책: {r.measure}</p>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className={confirmed ? "border-success" : ""}>
          <CardContent className="p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(!!v)} />
              <span className="text-sm">
                위 브리핑 내용과 위험요인·안전대책을 확인하였으며, 안전수칙을 준수하여 작업·관리하겠습니다. *
              </span>
            </label>
          </CardContent>
        </Card>

        <Card className={ppeChecked ? "border-success" : ""}>
          <CardContent className="p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <Checkbox checked={ppeChecked} onCheckedChange={(v) => setPpeChecked(!!v)} />
              <span className="text-sm">안전모, 안전화, 보호구(PPE)를 모두 착용하였습니다. *</span>
            </label>
          </CardContent>
        </Card>

        <Card className={understoodChecked ? "border-success" : ""}>
          <CardContent className="p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <Checkbox checked={understoodChecked} onCheckedChange={(v) => setUnderstoodChecked(!!v)} />
              <span className="text-sm">브리핑 내용을 충분히 이해했습니다. *</span>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">전자서명 *</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => sigRef.current?.clear()}>지우기</Button>
          </CardHeader>
          <CardContent>
            <div className="border-2 rounded-md bg-background">
              <ResponsiveSignaturePad ref={sigRef} height={160} />
            </div>
            <p className="text-xs text-muted-foreground mt-2">서명하면 TBM 참여자 명단에 바로 등록됩니다.</p>
          </CardContent>
        </Card>

        <Button onClick={() => void handleSubmit()} disabled={submitting} className="w-full h-12 text-base" size="lg">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          확인 후 서명하기
        </Button>
      </div>
    </div>
  );
}
