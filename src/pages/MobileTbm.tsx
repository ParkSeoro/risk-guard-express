import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { useAuditLog } from "@/hooks/useAuditLog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import IMESafeInput from "@/components/IMESafeInput";
import IMESafeTextarea from "@/components/IMESafeTextarea";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, QrCode, Copy, Users } from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";
import { correctTerms } from "@/lib/termCorrection";

// 모바일 TBM 즉석 진행 — 세션 생성 → QR 표시 → 참여 현황 폴링
export default function MobileTbm() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { projectId } = useMobileAccess();
  const { log: logAudit } = useAuditLog();
  const [creating, setCreating] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [participants, setParticipants] = useState<any[]>([]);
  const [form, setForm] = useState({ title: "", location: "", summary: "" });

  const portalUrl = session ? `${window.location.origin}/tbm/${session.qr_token}` : "";

  useEffect(() => {
    if (!portalUrl) return;
    QRCode.toDataURL(portalUrl, { width: 320, margin: 1 }).then(setQrDataUrl);
  }, [portalUrl]);

  useEffect(() => {
    if (!session) return;
    const tick = async () => {
      const { data } = await supabase.from("tbm_participations" as any)
        .select("worker_name, company_name, created_at")
        .eq("tbm_session_id", session.id)
        .order("created_at", { ascending: false });
      setParticipants((data as any) || []);
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => clearInterval(t);
  }, [session]);

  const create = async () => {
    if (!projectId) return toast.error("프로젝트를 먼저 선택하세요");
    if (!form.title.trim()) return toast.error("TBM 제목을 입력하세요");
    setCreating(true);
    try {
      const payload = {
        project_id: projectId,
        title: correctTerms(form.title),
        location: correctTerms(form.location),
        briefing_summary: correctTerms(form.summary),
        leader_name: profile?.display_name || "",
        created_by: profile?.user_id,
      };
      const { data, error } = await supabase.from("tbm_sessions" as any).insert(payload).select().single();
      if (error) throw error;
      setSession(data);
      await logAudit('create', 'tbm_session', (data as any).id, projectId, { title: payload.title });
      toast.success("TBM 세션이 생성되었습니다");
    } catch (e: any) {
      toast.error("생성 실패: " + e.message);
    } finally {
      setCreating(false);
    }
  };

  const copy = () => { navigator.clipboard.writeText(portalUrl); toast.success("링크 복사됨"); };

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      <header className="bg-primary text-primary-foreground p-4 flex items-center gap-3 sticky top-0 z-10">
        <Button size="icon" variant="ghost" className="text-primary-foreground" onClick={() => navigate("/m")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="font-bold text-lg">TBM 즉석 진행</div>
      </header>

      <main className="p-4 space-y-4 max-w-md mx-auto">
        {!projectId && (
          <Card className="border-warning/40 bg-warning/5">
            <CardContent className="pt-3 pb-3 text-sm">프로젝트를 먼저 선택하세요. <Button variant="link" size="sm" onClick={() => navigate("/m")}>홈으로</Button></CardContent>
          </Card>
        )}
        {!session ? (
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div>
                <Label className="text-base">TBM 제목 *</Label>
                <IMESafeInput className="h-12 text-base" defaultValue={form.title}
                  onCommit={(v) => setForm(f => ({ ...f, title: v }))}
                  placeholder="예: 3월 5일 굴착작업 TBM" />
              </div>
              <div>
                <Label className="text-base">장소</Label>
                <IMESafeInput className="h-12 text-base" defaultValue={form.location}
                  onCommit={(v) => setForm(f => ({ ...f, location: v }))} />
              </div>
              <div>
                <Label className="text-base">요약/위험요인</Label>
                <IMESafeTextarea rows={3} defaultValue={form.summary}
                  onCommit={(v) => setForm(f => ({ ...f, summary: v }))} />
              </div>
              <Button className="w-full h-14 text-base" onClick={create} disabled={creating || !projectId}>
                {creating && <Loader2 className="h-5 w-5 mr-2 animate-spin" />}
                <QrCode className="h-5 w-5 mr-2" /> 세션 생성 + QR 표시
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="pt-4 text-center space-y-3">
                <div className="font-bold text-base">{session.title}</div>
                {qrDataUrl && <img src={qrDataUrl} className="mx-auto rounded-lg border" />}
                <div className="text-xs text-muted-foreground break-all">{portalUrl}</div>
                <Button variant="outline" className="w-full" onClick={copy}>
                  <Copy className="h-4 w-4 mr-2" /> 링크 복사
                </Button>
                <p className="text-xs text-muted-foreground">근로자가 이 QR을 스캔하면 서명/참여 화면이 열립니다.</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 font-semibold">
                  <Users className="h-4 w-4" /> 참여자 ({participants.length})
                </div>
                <div className="mt-2 space-y-1 text-sm">
                  {participants.length === 0 && (
                    <div className="text-muted-foreground text-xs">아직 참여자가 없습니다. 자동 새로고침됩니다.</div>
                  )}
                  {participants.map((p, i) => (
                    <div key={i} className="flex justify-between border-b py-1.5">
                      <div>{p.worker_name} <span className="text-muted-foreground text-xs">{p.company_name}</span></div>
                      <div className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleTimeString("ko-KR")}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Button variant="outline" className="w-full h-12" onClick={() => navigate("/m")}>완료</Button>
          </>
        )}
      </main>
    </div>
  );
}
