import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNavigateMobileHome } from "@/lib/mobileNav";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { useAuditLog } from "@/hooks/useAuditLog";
import { usePreview } from "@/contexts/PreviewContext";
import { isManagerMobileRole } from "@/lib/mobileShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import IMESafeInput from "@/components/IMESafeInput";
import IMESafeTextarea from "@/components/IMESafeTextarea";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  Loader2,
  QrCode,
  Copy,
  Users,
  Plus,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";
import { z } from "zod";
import { correctTerms } from "@/lib/termCorrection";

const tbmSchema = z.object({
  title: z.string().trim().min(2, "TBM 제목을 2자 이상 입력하세요").max(200),
  location: z.string().trim().max(200).optional(),
  summary: z.string().trim().max(2000).optional(),
});

const PUBLIC_TBM_BASE = "https://safenex.org";

function todaySeoul(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

function buildTbmUrl(token: string) {
  return `${PUBLIC_TBM_BASE}/tbm/${encodeURIComponent(token)}`;
}

type TbmSession = {
  id: string;
  title: string;
  location?: string | null;
  briefing_summary?: string | null;
  leader_name?: string | null;
  qr_token?: string | null;
  tbm_date?: string | null;
  is_active?: boolean | null;
  created_at?: string | null;
};

/** Mobile TBM — manager: list + create/QR; worker: today’s participate */
export default function MobileTbm() {
  const navigate = useNavigate();
  const goMobileHome = useNavigateMobileHome();
  const { profile } = useAuth();
  const { projectId, companyId, applyCompanyFilter, role, isMaster } = useMobileAccess();
  const preview = usePreview();
  const { log: logAudit } = useAuditLog();

  const isManager = isManagerMobileRole(
    preview.isPreview ? preview.syntheticRole : role,
    preview.isPreview ? preview.syntheticRole === "master" : isMaster,
  );

  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<TbmSession[]>([]);
  const [mode, setMode] = useState<"list" | "create" | "qr">("list");
  const [creating, setCreating] = useState(false);
  const [session, setSession] = useState<TbmSession | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [participants, setParticipants] = useState<any[]>([]);
  const [form, setForm] = useState({ title: "", location: "", summary: "" });
  const [myParticipatedIds, setMyParticipatedIds] = useState<Set<string>>(new Set());

  const today = useMemo(() => todaySeoul(), []);
  const portalUrl = session?.qr_token ? buildTbmUrl(session.qr_token) : "";

  const loadSessions = async () => {
    if (!projectId) {
      setSessions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let q: any = supabase
      .from("tbm_sessions" as any)
      .select("id, title, location, briefing_summary, leader_name, qr_token, tbm_date, is_active, created_at")
      .eq("project_id", projectId)
      .eq("tbm_date", today)
      .order("created_at", { ascending: false })
      .limit(50);
    q = applyCompanyFilter(q);
    const { data, error } = await q;
    if (error) toast.error("TBM 목록 로드 실패: " + error.message);
    const rows = ((data as any[]) || []) as TbmSession[];
    setSessions(rows);

    // Worker: mark already participated (match by phone digits when available)
    const phone = (profile as any)?.phone?.replace(/\D/g, "") || "";
    if (!isManager && phone && rows.length) {
      const ids = rows.map((s) => s.id);
      const { data: parts } = await supabase
        .from("tbm_participations" as any)
        .select("tbm_session_id, worker_phone")
        .in("tbm_session_id", ids);
      const done = new Set<string>();
      for (const p of (parts as any[]) || []) {
        const pPhone = String(p.worker_phone || "").replace(/\D/g, "");
        if (pPhone && pPhone === phone) done.add(p.tbm_session_id);
      }
      setMyParticipatedIds(done);
    } else {
      setMyParticipatedIds(new Set());
    }
    setLoading(false);
  };

  useEffect(() => {
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, today, isManager, profile?.user_id]);

  useEffect(() => {
    if (!portalUrl) {
      setQrDataUrl("");
      return;
    }
    QRCode.toDataURL(portalUrl, { width: 320, margin: 1 }).then(setQrDataUrl);
  }, [portalUrl]);

  useEffect(() => {
    if (!session || !isManager) return;
    const tick = async () => {
      const { data } = await supabase
        .from("tbm_participations" as any)
        .select("worker_name, company_name, created_at")
        .eq("tbm_session_id", session.id)
        .order("created_at", { ascending: false });
      setParticipants((data as any) || []);
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => clearInterval(t);
  }, [session, isManager]);

  const openQr = async (s: TbmSession) => {
    let token = s.qr_token;
    if (!token) {
      token = crypto.randomUUID().replace(/-/g, "");
      const { error } = await supabase
        .from("tbm_sessions" as any)
        .update({ qr_token: token })
        .eq("id", s.id);
      if (error) {
        toast.error("QR 토큰 생성 실패: " + error.message);
        return;
      }
      s = { ...s, qr_token: token };
      setSessions((prev) => prev.map((x) => (x.id === s.id ? s : x)));
    }
    setSession(s);
    setMode("qr");
  };

  const create = async () => {
    if (!projectId) return toast.error("프로젝트를 먼저 선택하세요");
    if (!companyId) return toast.error("소속 회사가 필요합니다. 계정/프로젝트 멤버십을 확인하세요");
    const parsed = tbmSchema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message || "입력값을 확인하세요");
    setCreating(true);
    try {
      const payload = {
        project_id: projectId,
        company_id: companyId,
        tbm_date: today,
        title: correctTerms(form.title),
        location: correctTerms(form.location || ""),
        briefing_summary: correctTerms(form.summary || ""),
        leader_name: profile?.display_name || "",
        created_by: profile?.user_id,
        is_active: true,
      };
      const { data, error } = await supabase.from("tbm_sessions" as any).insert(payload).select().single();
      if (error) throw error;
      const created = data as TbmSession;
      setSession(created);
      setMode("qr");
      await logAudit("create", "tbm_session", created.id, projectId, { title: payload.title });
      toast.success("TBM 세션이 생성되었습니다");
      loadSessions();
    } catch (e: any) {
      toast.error("생성 실패: " + e.message);
    } finally {
      setCreating(false);
    }
  };

  const copy = () => {
    if (!portalUrl) return;
    navigator.clipboard.writeText(portalUrl);
    toast.success("링크 복사됨");
  };

  const headerTitle = isManager
    ? mode === "create"
      ? "TBM 생성"
      : mode === "qr"
        ? "TBM QR"
        : "TBM 진행"
    : "오늘 TBM 참여";

  const back = () => {
    if (isManager && (mode === "create" || mode === "qr")) {
      setMode("list");
      setSession(null);
      setParticipants([]);
      return;
    }
    goMobileHome();
  };

  const activeToday = sessions.filter((s) => s.is_active !== false);

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      <header className="bg-primary text-primary-foreground p-4 flex items-center gap-3 sticky top-0 z-10">
        <Button size="icon" variant="ghost" className="text-primary-foreground" onClick={back}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="font-bold text-lg flex-1">{headerTitle}</div>
        {isManager && mode === "list" && (
          <Button size="sm" variant="secondary" onClick={() => setMode("create")}>
            <Plus className="h-4 w-4 mr-1" /> 생성
          </Button>
        )}
      </header>

      <main className="p-4 space-y-4 max-w-md mx-auto">
        {!projectId && (
          <Card className="border-warning/40 bg-warning/5">
            <CardContent className="pt-3 pb-3 text-sm">
              프로젝트를 먼저 선택하세요.{" "}
              <Button variant="link" size="sm" onClick={() => goMobileHome()}>홈으로</Button>
            </CardContent>
          </Card>
        )}

        {loading && (
          <div className="text-center py-8">
            <Loader2 className="h-5 w-5 animate-spin inline" />
          </div>
        )}

        {/* Manager: create form */}
        {isManager && mode === "create" && (
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div>
                <Label className="text-base">TBM 제목 *</Label>
                <IMESafeInput
                  className="h-12 text-base"
                  defaultValue={form.title}
                  onCommit={(v) => setForm((f) => ({ ...f, title: v }))}
                  placeholder="예: 굴착작업 TBM"
                />
              </div>
              <div>
                <Label className="text-base">장소</Label>
                <IMESafeInput
                  className="h-12 text-base"
                  defaultValue={form.location}
                  onCommit={(v) => setForm((f) => ({ ...f, location: v }))}
                />
              </div>
              <div>
                <Label className="text-base">요약/위험요인</Label>
                <IMESafeTextarea
                  rows={3}
                  defaultValue={form.summary}
                  onCommit={(v) => setForm((f) => ({ ...f, summary: v }))}
                />
              </div>
              <Button className="w-full h-14 text-base" onClick={create} disabled={creating || !projectId}>
                {creating && <Loader2 className="h-5 w-5 mr-2 animate-spin" />}
                <QrCode className="h-5 w-5 mr-2" /> 세션 생성 + QR 표시
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Manager: QR + participants */}
        {isManager && mode === "qr" && session && (
          <>
            <Card>
              <CardContent className="pt-4 text-center space-y-3">
                <div className="font-bold text-base">{session.title}</div>
                {qrDataUrl && <img src={qrDataUrl} alt="TBM QR" className="mx-auto rounded-lg border" />}
                <div className="text-xs text-muted-foreground break-all">{portalUrl}</div>
                <Button variant="outline" className="w-full" onClick={copy}>
                  <Copy className="h-4 w-4 mr-2" /> 링크 복사
                </Button>
                <p className="text-xs text-muted-foreground">
                  근로자가 이 QR을 스캔하면 서명/참여 화면이 열립니다.
                </p>
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
                      <div>
                        {p.worker_name}{" "}
                        <span className="text-muted-foreground text-xs">{p.company_name}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(p.created_at).toLocaleTimeString("ko-KR")}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Button variant="outline" className="w-full h-12" onClick={() => { setMode("list"); setSession(null); }}>
              목록으로
            </Button>
          </>
        )}

        {/* Manager list */}
        {isManager && mode === "list" && !loading && (
          <>
            <p className="text-xs text-muted-foreground">오늘({today}) 진행 중인 TBM을 관리합니다.</p>
            {sessions.length === 0 && (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground space-y-3">
                  <div>오늘 생성된 TBM이 없습니다.</div>
                  <Button onClick={() => setMode("create")}>
                    <Plus className="h-4 w-4 mr-1" /> TBM 생성
                  </Button>
                </CardContent>
              </Card>
            )}
            {sessions.map((s) => (
              <Card key={s.id}>
                <CardContent className="pt-4 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm">{s.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.location || "장소 미정"} · {s.leader_name || "—"}
                      </div>
                    </div>
                    <Badge variant={s.is_active === false ? "secondary" : "default"}>
                      {s.is_active === false ? "종료" : "진행중"}
                    </Badge>
                  </div>
                  <Button className="w-full" variant="outline" onClick={() => openQr(s)}>
                    <QrCode className="h-4 w-4 mr-1" /> QR · 참여자
                  </Button>
                </CardContent>
              </Card>
            ))}
          </>
        )}

        {/* Worker: today’s participate */}
        {!isManager && !loading && (
          <>
            <p className="text-xs text-muted-foreground">
              오늘 진행 중인 TBM에 참여·서명합니다. 새 TBM 생성은 관리자만 가능합니다.
            </p>
            {activeToday.length === 0 && (
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  오늘 참여 가능한 TBM이 없습니다.
                </CardContent>
              </Card>
            )}
            {activeToday.map((s) => {
              const done = myParticipatedIds.has(s.id);
              const token = s.qr_token;
              return (
                <Card key={s.id}>
                  <CardContent className="pt-4 space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm">{s.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {s.location || "장소 미정"} · {s.leader_name || "—"}
                        </div>
                      </div>
                      {done ? (
                        <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30" variant="outline">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> 참여완료
                        </Badge>
                      ) : (
                        <Badge variant="secondary">미참여</Badge>
                      )}
                    </div>
                    {s.briefing_summary && (
                      <div className="text-xs bg-muted/40 rounded p-2 whitespace-pre-wrap line-clamp-3">
                        {s.briefing_summary}
                      </div>
                    )}
                    <Button
                      className="w-full"
                      disabled={!token || done}
                      onClick={() => {
                        if (!token) {
                          toast.error("QR 토큰이 아직 없습니다. 관리자에게 문의하세요.");
                          return;
                        }
                        window.location.href = buildTbmUrl(token);
                      }}
                    >
                      <ExternalLink className="h-4 w-4 mr-1" />
                      {done ? "이미 참여함" : "참여 · 서명하기"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
            <Button variant="outline" className="w-full" onClick={() => navigate("/app/worker/today")}>
              오늘 홈으로
            </Button>
          </>
        )}
      </main>
    </div>
  );
}
