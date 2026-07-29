/**
 * Worker daily life-cycle dashboard:
 * GPS 100m check-in → TBM briefing signature → no-accident check-out.
 * Maps check_in_time → worker_entry_logs.entry_at, check_out → exit_at.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemRealtime } from "@/providers/SystemRealtimeProvider";
import { calculateDistance, isWithinSiteRadius } from "@/lib/geo/calculateDistance";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { HardHat, MapPin, LogIn, LogOut, FileSignature, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const PROJECT_KEY = "selectedProjectId";
const SITE_RADIUS_M = 100;

type EntryLog = {
  id: string;
  entry_at: string;
  exit_at: string | null;
  tbm_confirmed: boolean;
  no_accident_confirmed: boolean;
};

type TbmSession = {
  id: string;
  title: string;
  briefing_summary: string;
  tbm_date: string;
};

export default function WorkerDailyHome() {
  const { user, profile } = useAuth();
  const { lastGpsFix, gpsTracking, gpsError, startGpsTracking, stopGpsTracking } = useSystemRealtime();
  const [projectId, setProjectId] = useState(() => localStorage.getItem(PROJECT_KEY) || "");
  const [siteLat, setSiteLat] = useState<number | null>(null);
  const [siteLng, setSiteLng] = useState<number | null>(null);
  const [projectName, setProjectName] = useState("");
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [todayLog, setTodayLog] = useState<EntryLog | null>(null);
  const [tbmSession, setTbmSession] = useState<TbmSession | null>(null);
  const [tbmOpen, setTbmOpen] = useState(false);
  const [tbmChecked, setTbmChecked] = useState(false);
  const [tbmSig, setTbmSig] = useState("");
  const [exitOpen, setExitOpen] = useState(false);
  const [noAccident, setNoAccident] = useState(false);
  const [healthOk, setHealthOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const distanceM = useMemo(() => {
    if (siteLat == null || siteLng == null || !lastGpsFix) return null;
    return calculateDistance(siteLat, siteLng, lastGpsFix.lat, lastGpsFix.lng);
  }, [siteLat, siteLng, lastGpsFix]);

  const within100m = useMemo(() => {
    if (siteLat == null || siteLng == null || !lastGpsFix) return false;
    return isWithinSiteRadius(siteLat, siteLng, lastGpsFix.lat, lastGpsFix.lng, SITE_RADIUS_M);
  }, [siteLat, siteLng, lastGpsFix]);

  const isCheckedIn = !!todayLog && !todayLog.exit_at;
  const tbmDone = !!todayLog?.tbm_confirmed;
  const checkedOut = !!todayLog?.exit_at;

  const refresh = useCallback(async () => {
    const pid = localStorage.getItem(PROJECT_KEY) || "";
    setProjectId(pid);
    if (!pid || !user) return;

    const { data: proj } = await supabase
      .from("projects")
      .select("id, name, site_lat, site_lng")
      .eq("id", pid)
      .maybeSingle();
    if (proj) {
      setProjectName(proj.name || "");
      setSiteLat(proj.site_lat);
      setSiteLng(proj.site_lng);
    }

    let wid: string | null = null;
    if (profile?.phone) {
      const digits = profile.phone.replace(/\D/g, "");
      const { data: workers } = await supabase
        .from("workers")
        .select("id, phone, name")
        .eq("project_id", pid)
        .eq("is_active", true)
        .limit(100);
      wid =
        (workers || []).find((w) => (w.phone || "").replace(/\D/g, "") === digits)?.id || null;
      setWorkerId(wid);
    }

    if (wid) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const { data: logs } = await supabase
        .from("worker_entry_logs")
        .select("id, entry_at, exit_at, tbm_confirmed, no_accident_confirmed")
        .eq("worker_id", wid)
        .eq("project_id", pid)
        .gte("entry_at", start.toISOString())
        .order("entry_at", { ascending: false })
        .limit(1);
      setTodayLog((logs?.[0] as EntryLog) || null);
    } else {
      setTodayLog(null);
    }

    const today = new Date().toISOString().slice(0, 10);
    const { data: tbms } = await supabase
      .from("tbm_sessions")
      .select("id, title, briefing_summary, tbm_date")
      .eq("project_id", pid)
      .eq("tbm_date", today)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(1);
    setTbmSession((tbms?.[0] as TbmSession) || null);

    // Start GPS even before workers-row match so distance UI can update
    if (pid && !gpsTracking) {
      const { setTrackingConsent, hasTrackingConsent, normalizeTrackingConsentStorage } =
        await import("@/lib/tracking/locationTracker");
      normalizeTrackingConsentStorage();
      if (profile?.agreed_to_location === true || hasTrackingConsent()) {
        setTrackingConsent(true);
        startGpsTracking({
          project_id: pid,
          worker_id: wid,
          worker_name: profile?.display_name || null,
          worker_phone: profile?.phone || null,
        });
      }
    }
  }, [user, profile, gpsTracking, startGpsTracking]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (isCheckedIn && !tbmDone) setTbmOpen(true);
  }, [isCheckedIn, tbmDone]);

  const ensureConsentAndGps = async () => {
    const { setTrackingConsent } = await import("@/lib/tracking/locationTracker");
    setTrackingConsent(true);
    if (!projectId) {
      toast.error("현장을 먼저 선택하세요");
      return false;
    }
    startGpsTracking({
      project_id: projectId,
      worker_id: workerId,
      worker_name: profile?.display_name || null,
      worker_phone: profile?.phone || null,
    });
    return true;
  };

  const handleCheckIn = async () => {
    if (!within100m) {
      toast.error("현장 사무실 반경 100m 이내에서만 출근할 수 있습니다");
      return;
    }
    if (!workerId || !projectId) {
      toast.error("근로자 프로필(전화↔workers)을 찾을 수 없습니다. 관리자에게 등록을 요청하세요.");
      return;
    }
    if (!(await ensureConsentAndGps())) return;
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("worker_entry_logs")
        .insert({
          worker_id: workerId,
          project_id: projectId,
          entry_at: new Date().toISOString(),
          entry_method: "gps",
          tbm_confirmed: false,
          no_accident_confirmed: false,
          risk_assessment_confirmed: false,
          education_confirmed: false,
        })
        .select("id, entry_at, exit_at, tbm_confirmed, no_accident_confirmed")
        .single();
      if (error) throw error;
      setTodayLog(data as EntryLog);
      setTbmOpen(true);
      toast.success("출근이 기록되었습니다");
    } catch (e: any) {
      toast.error(e?.message || "출근 기록 실패");
    } finally {
      setBusy(false);
    }
  };

  const handleTbmConfirm = async () => {
    if (!tbmChecked || !tbmSig.trim()) {
      toast.error("브리핑 확인과 서명을 완료하세요");
      return;
    }
    if (!todayLog || !workerId) return;
    setBusy(true);
    try {
      if (tbmSession) {
        await supabase.from("tbm_participations").upsert(
          {
            tbm_session_id: tbmSession.id,
            worker_id: workerId,
            worker_name: profile?.display_name || "",
            worker_phone: profile?.phone || "",
            company_name: profile?.company || "",
            briefing_confirmed: true,
            signature_data: tbmSig.trim(),
          },
          { onConflict: "tbm_session_id,worker_phone" },
        );
      }
      const { data, error } = await supabase
        .from("worker_entry_logs")
        .update({ tbm_confirmed: true })
        .eq("id", todayLog.id)
        .select("id, entry_at, exit_at, tbm_confirmed, no_accident_confirmed")
        .single();
      if (error) throw error;
      setTodayLog(data as EntryLog);
      setTbmOpen(false);
      toast.success("TBM / 작업 브리핑 확인 완료");
    } catch (e: any) {
      toast.error(e?.message || "TBM 확인 실패");
    } finally {
      setBusy(false);
    }
  };

  const handleCheckOut = async () => {
    if (!noAccident || !healthOk) {
      toast.error("무재해 서약과 건강상태 확인에 체크해야 퇴근할 수 있습니다");
      return;
    }
    if (!todayLog) return;
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("worker_entry_logs")
        .update({
          exit_at: new Date().toISOString(),
          no_accident_confirmed: true,
        })
        .eq("id", todayLog.id)
        .select("id, entry_at, exit_at, tbm_confirmed, no_accident_confirmed")
        .single();
      if (error) throw error;
      setTodayLog(data as EntryLog);
      setExitOpen(false);
      stopGpsTracking();
      toast.success("퇴근이 기록되었습니다. GPS 추적을 종료합니다.");
    } catch (e: any) {
      toast.error(e?.message || "퇴근 기록 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 via-sky-50 to-emerald-50 pb-24">
      <header className="bg-slate-900 text-white p-4 flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-white/10 flex items-center justify-center">
          <HardHat className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <div className="font-bold text-lg leading-tight">일일 안전 출퇴근</div>
          <div className="text-xs opacity-80">{profile?.display_name || "근로자"} · {projectName || "현장 미선택"}</div>
        </div>
        <Button asChild variant="secondary" size="sm" className="h-8 text-xs">
          <Link to="/app/worker/menu">메뉴</Link>
        </Button>
      </header>

      <main className="p-4 space-y-4 max-w-lg mx-auto">
        <section className="rounded-2xl bg-white/80 backdrop-blur border border-slate-200 p-4 space-y-3 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <MapPin className="h-4 w-4 text-emerald-600" />
            GPS · 현장 100m 지오펜스
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
            <div>추적: {gpsTracking ? "ON" : "OFF"}</div>
            <div>
              거리:{" "}
              {siteLat == null || siteLng == null
                ? "현장 좌표 미설정"
                : !lastGpsFix
                  ? (gpsError ? "GPS 오류" : "GPS 대기…")
                  : `${Math.round(distanceM!)}m`}
            </div>
            <div className="col-span-2">
              좌표:{" "}
              {lastGpsFix
                ? `${lastGpsFix.lat.toFixed(5)}, ${lastGpsFix.lng.toFixed(5)} (±${Math.round(lastGpsFix.accuracy)}m)`
                : "대기"}
            </div>
            <div className="col-span-2">
              현장 기준:{" "}
              {siteLat != null && siteLng != null
                ? `${siteLat.toFixed(5)}, ${siteLng.toFixed(5)}`
                : "projects.site_lat/lng 미설정 — 관리자가 프로젝트에 현장 좌표를 넣어야 합니다"}
            </div>
            {gpsError && (
              <div className="col-span-2 text-destructive">GPS: {gpsError}</div>
            )}
          </div>
          <Badge variant={within100m ? "default" : "secondary"}>
            {siteLat == null || siteLng == null
              ? "현장 좌표 없음 — 출근 불가"
              : within100m
                ? "반경 100m 이내 — 출근 가능"
                : "반경 밖 — 출근 비활성"}
          </Badge>
          {!gpsTracking && (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => void ensureConsentAndGps()}
            >
              GPS 다시 시작
            </Button>
          )}
        </section>

        <section className="rounded-2xl bg-white/80 border border-slate-200 p-4 space-y-3 shadow-sm">
          <div className="text-sm font-semibold text-slate-800">오늘 상태</div>
          <ol className="space-y-2 text-sm">
            <li className={isCheckedIn || checkedOut ? "text-emerald-700" : "text-slate-500"}>
              1. 출근 {todayLog?.entry_at ? `· ${new Date(todayLog.entry_at).toLocaleTimeString("ko-KR")}` : ""}
            </li>
            <li className={tbmDone ? "text-emerald-700" : "text-slate-500"}>
              2. TBM / 브리핑 서명 {tbmDone ? "완료" : isCheckedIn ? "대기" : "—"}
            </li>
            <li className={checkedOut ? "text-emerald-700" : "text-slate-500"}>
              3. 무재해 서약 · 퇴근 {todayLog?.exit_at ? `· ${new Date(todayLog.exit_at).toLocaleTimeString("ko-KR")}` : ""}
            </li>
          </ol>

          <div className="flex flex-col gap-2 pt-1">
            {!isCheckedIn && !checkedOut && (
              <Button
                className="h-12 gap-2"
                disabled={!within100m || busy || !workerId}
                onClick={() => void handleCheckIn()}
              >
                <LogIn className="h-4 w-4" />
                출근하기
              </Button>
            )}
            {isCheckedIn && (
              <>
                {!tbmDone && (
                  <Button variant="outline" className="h-11 gap-2" onClick={() => setTbmOpen(true)}>
                    <FileSignature className="h-4 w-4" />
                    TBM 및 작업 브리핑 확인
                  </Button>
                )}
                <Button
                  variant="destructive"
                  className="h-12 gap-2"
                  disabled={!tbmDone || busy}
                  onClick={() => setExitOpen(true)}
                >
                  <LogOut className="h-4 w-4" />
                  퇴근하기
                </Button>
              </>
            )}
            {checkedOut && (
              <div className="text-center text-sm text-emerald-700 py-2 flex items-center justify-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                오늘 일일 파이프라인 완료
              </div>
            )}
          </div>
        </section>
      </main>

      <Dialog open={tbmOpen} onOpenChange={(o) => { if (tbmDone) setTbmOpen(o); }}>
        <DialogContent className="max-w-md" onPointerDownOutside={(e) => !tbmDone && e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>TBM 및 작업 브리핑 확인</DialogTitle>
            <DialogDescription>
              출근 후 필수입니다. 브리핑을 확인하고 서명하세요.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-md bg-slate-50 p-3 border">
              <div className="font-medium">{tbmSession?.title || "금일 TBM"}</div>
              <p className="text-muted-foreground mt-1 whitespace-pre-wrap">
                {tbmSession?.briefing_summary || "관리자가 등록한 금일 TBM이 없으면 기본 안전 수칙을 확인하세요. PPE 착용, 위험구역 출입 금지, 이상 시 즉시 보고."}
              </p>
            </div>
            <label className="flex items-start gap-2">
              <Checkbox checked={tbmChecked} onCheckedChange={(v) => setTbmChecked(v === true)} />
              <span>작업 브리핑·위험요인을 확인했고 TBM에 참석합니다.</span>
            </label>
            <input
              className="w-full h-10 rounded-md border px-3 text-sm"
              placeholder="서명 (성명)"
              value={tbmSig}
              onChange={(e) => setTbmSig(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button disabled={busy} onClick={() => void handleTbmConfirm()}>
              서명 · 참석 확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={exitOpen} onOpenChange={setExitOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>일일 무재해 서약서 및 건강상태 확인</DialogTitle>
            <DialogDescription>퇴근 전 필수 확인입니다.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <label className="flex items-start gap-2">
              <Checkbox checked={noAccident} onCheckedChange={(v) => setNoAccident(v === true)} />
              <span>오늘 사고나 다친 곳이 없습니다.</span>
            </label>
            <label className="flex items-start gap-2">
              <Checkbox checked={healthOk} onCheckedChange={(v) => setHealthOk(v === true)} />
              <span>현재 건강상태에 이상 없음을 확인합니다.</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExitOpen(false)}>취소</Button>
            <Button disabled={busy} onClick={() => void handleCheckOut()}>
              서약 후 퇴근
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
