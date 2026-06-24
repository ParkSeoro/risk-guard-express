import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, ClipboardCheck, QrCode, Bell, FileCheck2, HardHat, LogIn, BookOpen, Wifi, WifiOff, Wrench, ShieldAlert, ClipboardList, Users, AlertOctagon, ScanLine, HeartPulse, Settings2, RotateCcw } from "lucide-react";
import { isOnline, listQueue } from "@/lib/offlineQueue";
import { isPushSupported, registerSW, subscribeToPush } from "@/lib/pushSubscription";
import { setForceDesktop } from "@/components/MobileRedirectGuard";
import { toast } from "sonner";
import { ALL_TILES, MobileTileKey, getMobileTiles, setMobileTiles, resetMobileTiles, detectRole } from "@/lib/mobileMenuPrefs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";

// 모바일 통합 홈 — 로그인 사용자(관리자) / 비로그인(근로자 안내)
export default function MobileHome() {
  const navigate = useNavigate();
  const { user, profile, loading, hasRole } = useAuth();
  const isMaster = hasRole('master');
  const role = detectRole(hasRole);
  const [unread, setUnread] = useState(0);
  const [queueCount, setQueueCount] = useState(0);
  const [online, setOnline] = useState(isOnline());
  const [projects, setProjects] = useState<{ id: string; name: string; site_name: string }[]>([]);
  const [tiles, setTiles] = useState<MobileTileKey[]>(() => getMobileTiles(role));
  const [editOpen, setEditOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectIdState] = useState<string>(() => {
    try { return localStorage.getItem("selectedProjectId") || ""; } catch { return ""; }
  });

  const setSelectedProjectId = (id: string) => {
    setSelectedProjectIdState(id);
    try { localStorage.setItem("selectedProjectId", id); } catch {}
    try { window.dispatchEvent(new Event('mobile:project-changed')); } catch {}
    const p = projects.find(x => x.id === id);
    toast.success("프로젝트 선택: " + (p?.name || ""));
  };

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  useEffect(() => {
    listQueue().then(q => setQueueCount(q.length)).catch(() => {});
    if (!user) return;
    supabase.from("notifications").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).eq("is_read", false)
      .then(({ count }) => setUnread(count || 0));
    registerSW();

    // 프로젝트 목록 로드 — 마스터: 전체 / 일반: 가입된 것 (자동 단일 선택)
    (async () => {
      let list: { id: string; name: string; site_name: string }[] = [];
      if (isMaster) {
        const { data } = await supabase.from("projects").select("id, name, site_name").order("created_at", { ascending: false });
        list = data || [];
      } else {
        const { data } = await supabase
          .from("project_members")
          .select("projects(id, name, site_name)")
          .eq("user_id", user.id);
        list = (data || []).map((m: any) => m.projects).filter(Boolean);
      }
      setProjects(list);
      const cur = localStorage.getItem("selectedProjectId");
      const validCur = cur && list.some(p => p.id === cur);
      if (validCur) {
        setSelectedProjectIdState(cur!);
      } else if (list.length > 0) {
        // 마스터: 다중 프로젝트면 직접 선택, 단일이면 자동
        // 일반: 항상 첫 프로젝트 자동 설정
        if (!isMaster || list.length === 1) {
          localStorage.setItem("selectedProjectId", list[0].id);
          setSelectedProjectIdState(list[0].id);
          if (!isMaster) toast.message("프로젝트 자동 선택: " + list[0].name);
        }
      } else {
        toast.error(isMaster ? "등록된 프로젝트가 없습니다" : "가입된 프로젝트가 없습니다 — 관리자에게 문의하세요");
      }
    })();
  }, [user, isMaster]);

  const enablePush = async () => {
    if (!user) return;
    if (!isPushSupported()) { toast.error("이 브라우저는 푸시 알림을 지원하지 않습니다"); return; }
    const r = await subscribeToPush(user.id);
    if (r.ok) toast.success("푸시 알림이 활성화되었습니다");
    else toast.error("푸시 알림 활성화 실패: " + (r.reason || ""));
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">로딩…</div>;

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      <header className="bg-primary text-primary-foreground p-4 flex items-center gap-3 sticky top-0 z-10">
        <div className="h-10 w-10 rounded-lg bg-primary-foreground/10 flex items-center justify-center">
          <HardHat className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <div className="font-bold text-lg leading-tight">안전관리</div>
          <div className="text-xs opacity-80">{profile?.display_name || "현장 모바일"}</div>
        </div>
        <Badge variant={online ? "secondary" : "destructive"} className="gap-1">
          {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {online ? "온라인" : "오프라인"}
        </Badge>
      </header>

      <main className="p-4 space-y-4 max-w-md mx-auto">
        {!user && (
          <Card className="border-primary/40 bg-primary/5">
            <CardContent className="pt-4 space-y-3">
              <div className="font-bold text-lg">근로자이신가요?</div>
              <p className="text-sm text-muted-foreground">QR을 받지 못했다면 관리자에게 문의하세요.</p>
              <div className="grid gap-2">
                <Button className="w-full h-14 text-base" onClick={() => navigate("/worker/register")}>
                  <QrCode className="h-5 w-5 mr-2" /> 근로자 등록
                </Button>
                <Button variant="outline" className="w-full h-12" onClick={() => navigate("/auth")}>
                  <LogIn className="h-5 w-5 mr-2" /> 관리자 로그인
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {user && (
          <>
            {/* 프로젝트 선택 (마스터: 전체 / 일반: 가입 프로젝트) */}
            {projects.length > 0 && (
              <Card>
                <CardContent className="pt-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5" />
                    <span>{isMaster ? "프로젝트 선택 (마스터)" : "현재 프로젝트"}</span>
                  </div>
                  {isMaster && projects.length > 1 ? (
                    <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                      <SelectTrigger className="h-11"><SelectValue placeholder="프로젝트를 선택하세요" /></SelectTrigger>
                      <SelectContent>
                        {projects.map(p => (
                          <SelectItem key={p.id} value={p.id}>
                            <div className="flex flex-col">
                              <span className="font-medium">{p.name}</span>
                              <span className="text-[10px] text-muted-foreground">{p.site_name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="text-sm font-medium">
                      {projects.find(p => p.id === selectedProjectId)?.name || "선택되지 않음"}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {queueCount > 0 && (
              <Card className="border-warning/40 bg-warning/5">
                <CardContent className="pt-4 text-sm">
                  대기중인 동기화 항목 <strong>{queueCount}건</strong>
                </CardContent>
              </Card>
            )}
            <div className="grid grid-cols-2 gap-3">
              <ActionTile icon={ClipboardCheck} label="안전점검" sub="현장 점검 등록"
                onClick={() => navigate("/m/inspect")} highlight />
              <ActionTile icon={AlertOctagon} label="사고 신고" sub="아차/경미/중대"
                onClick={() => navigate("/m/incident")} />
              <ActionTile icon={Users} label="TBM 진행" sub="QR 발급/참여"
                onClick={() => navigate("/m/tbm")} />
              <ActionTile icon={ScanLine} label="QR 스캔" sub="근로자 출입"
                onClick={() => navigate("/m/scan")} />
              <ActionTile icon={FileCheck2} label="허가서 결재" sub="대기 결재"
                onClick={() => navigate("/m/permits")} />
              <ActionTile icon={Wrench} label="조치 관리" sub="진행중/완료"
                onClick={() => navigate("/m/actions")} />
              <ActionTile icon={Bell} label="알림" sub={`미확인 ${unread}건`}
                onClick={() => navigate("/m/alerts")} />
              <ActionTile icon={FileCheck2} label="결재함" sub="위험성평가"
                onClick={() => navigate("/m/approvals")} />
              <ActionTile icon={ShieldAlert} label="위험성평가" sub="요약 보기"
                onClick={() => navigate("/m/risk-assessment")} />
              <ActionTile icon={ClipboardList} label="작업계획" sub="목록/상태"
                onClick={() => navigate("/m/work-plans")} />
              <ActionTile icon={QrCode} label="근로자 QR" sub="발급/조회"
                onClick={() => navigate("/m/workers")} />
              <ActionTile icon={HardHat} label="입퇴장 현황" sub="오늘 출입"
                onClick={() => navigate("/worker-attendance")} />
              <ActionTile icon={BookOpen} label="사용 설명서" sub="도움말"
                onClick={() => navigate("/manual")} />
            </div>

            <Button variant="outline" className="w-full h-12" onClick={enablePush}>
              <Bell className="h-4 w-4 mr-2" /> 푸시 알림 켜기
            </Button>
            <Button variant="ghost" className="w-full h-12" onClick={() => { setForceDesktop(true); navigate("/"); }}>
              데스크톱 화면으로 전환
            </Button>
          </>
        )}
      </main>
    </div>
  );
}

function ActionTile({ icon: Icon, label, sub, onClick, highlight }: any) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-4 rounded-xl border-2 transition active:scale-95 ${
        highlight ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border"
      }`}
    >
      <Icon className="h-7 w-7 mb-2" />
      <div className="font-bold text-base leading-tight">{label}</div>
      <div className={`text-xs mt-0.5 ${highlight ? "opacity-80" : "text-muted-foreground"}`}>{sub}</div>
    </button>
  );
}
