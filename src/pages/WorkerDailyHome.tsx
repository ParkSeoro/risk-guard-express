/**
 * Worker daily life-cycle dashboard:
 * GPS fence check → work/risk confirm + handwritten signature → entry logged → check-out pledge.
 * Signature stored in worker_daily_acks and reused for linked TBM sessions.
 * Hard gate: no entry without signature; no checkout without daily ack + 무재해 서약.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemRealtime } from "@/providers/SystemRealtimeProvider";
import { calculateDistance } from "@/lib/geo/calculateDistance";
import {
  isInsideCheckInFence,
  resolveSiteCheckInFence,
  SITE_CHECKIN_MIN_M,
  type SiteTrackingFence,
} from "@/lib/tracking/siteTrackBounds";
import {
  buildRiskSummary,
  buildWorkSummary,
  fetchTodayAck,
  fetchWorkerDayPermits,
  saveDailyWorkAck,
  type DailyPermitBrief,
} from "@/lib/dailyWorkAck";
import ResponsiveSignaturePad, {
  type ResponsiveSignaturePadHandle,
} from "@/components/ResponsiveSignaturePad";
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
import { HardHat, MapPin, LogIn, LogOut, FileSignature, ShieldCheck, OctagonAlert } from "lucide-react";
import {
  shouldShowHomeGpsCard,
  shouldShowHomeWorkStopCard,
  WORK_STOP_LEGAL_CITE,
} from "@/lib/workStop";
import { toast } from "sonner";
import { useActiveProject } from "@/hooks/useActiveProject";
import { readActiveProjectId } from "@/lib/activeProject";

import {
  HEALTH_PLEDGE,
  NO_ACCIDENT_PLEDGE,
  WORK_ACK_PLEDGE,
} from "@/lib/legal/dailyPledges";

type EntryLog = {
  id: string;
  entry_at: string;
  exit_at: string | null;
  tbm_confirmed: boolean;
  no_accident_confirmed: boolean;
};

export default function WorkerDailyHome({
  embedded = false,
  diagnosticsOnly = false,
}: {
  embedded?: boolean;
  /** 더보기 → 위치·GPS: full diagnostic panel, no check-in chrome. */
  diagnosticsOnly?: boolean;
}) {
  const { user, profile } = useAuth();
  const { lastGpsFix, gpsTracking, gpsError, startGpsTracking, stopGpsTracking } = useSystemRealtime();
  const { projectId, setProjectId } = useActiveProject();
  /** One-shot / polled fix for check-in distance UI before full tracking starts. */
  const [probeFix, setProbeFix] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [probeNonce, setProbeNonce] = useState(0);
  const [checkInFence, setCheckInFence] = useState<SiteTrackingFence | null>(null);
  const [projectName, setProjectName] = useState("");
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [todayLog, setTodayLog] = useState<EntryLog | null>(null);
  const [ackOpen, setAckOpen] = useState(false);
  const [ackDone, setAckDone] = useState(false);
  const [dayPermits, setDayPermits] = useState<DailyPermitBrief[]>([]);
  const [workSummary, setWorkSummary] = useState("");
  const [riskSummary, setRiskSummary] = useState("");
  const [ackWorkOk, setAckWorkOk] = useState(false);
  const [ackRiskOk, setAckRiskOk] = useState(false);
  const [ackPledgeOk, setAckPledgeOk] = useState(false);
  const [pendingEntry, setPendingEntry] = useState(false);
  const ackSigRef = useRef<ResponsiveSignaturePadHandle | null>(null);
  const exitSigRef = useRef<ResponsiveSignaturePadHandle | null>(null);
  const [exitOpen, setExitOpen] = useState(false);
  const [noAccident, setNoAccident] = useState(false);
  const [healthOk, setHealthOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [suspension, setSuspension] = useState<{
    until: string;
    reason: string | null;
    kind: string | null;
  } | null>(null);

  const effectiveFix = lastGpsFix || probeFix;

  const distanceM = useMemo(() => {
    if (!checkInFence || !effectiveFix) return null;
    return calculateDistance(
      checkInFence.lat,
      checkInFence.lng,
      effectiveFix.lat,
      effectiveFix.lng,
    );
  }, [checkInFence, effectiveFix]);

  const withinCheckIn = useMemo(() => {
    if (!checkInFence || !effectiveFix) return false;
    return isInsideCheckInFence(
      checkInFence,
      effectiveFix.lat,
      effectiveFix.lng,
      effectiveFix.accuracy,
    );
  }, [checkInFence, effectiveFix]);

  const isCheckedIn = !!todayLog && !todayLog.exit_at;
  const checkedOut = !!todayLog?.exit_at;

  const refresh = useCallback(async () => {
    const pid = readActiveProjectId();
    setProjectId(pid);
    if (!pid || !user) return;

    const { data: proj } = await supabase
      .from("projects")
      .select("id, name, site_lat, site_lng")
      .eq("id", pid)
      .maybeSingle();
    if (proj) {
      setProjectName(proj.name || "");
    }
    // Prefer georeferenced site_maps footprint over address-geocoded pin
    const fence = await resolveSiteCheckInFence(pid);
    setCheckInFence(fence);

    let wid: string | null = null;
    if (profile?.phone) {
      const digits = profile.phone.replace(/\D/g, "");
      const { data: workers } = await supabase
        .from("workers")
        .select(
          "id, phone, name, site_entry_suspended_until, site_entry_suspension_reason, site_entry_suspension_kind",
        )
        .eq("project_id", pid)
        .eq("is_active", true)
        .limit(100);
      const matched = (workers || []).find(
        (w) => (w.phone || "").replace(/\D/g, "") === digits,
      ) as any;
      wid = matched?.id || null;
      setWorkerId(wid);
      if (
        matched?.site_entry_suspended_until &&
        new Date(matched.site_entry_suspended_until).getTime() > Date.now()
      ) {
        setSuspension({
          until: matched.site_entry_suspended_until,
          reason: matched.site_entry_suspension_reason,
          kind: matched.site_entry_suspension_kind,
        });
      } else {
        setSuspension(null);
      }
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
      const ack = await fetchTodayAck(pid, wid);
      setAckDone(!!ack || !!(logs?.[0] as EntryLog | undefined)?.tbm_confirmed);
      const permits = await fetchWorkerDayPermits(pid, wid);
      setDayPermits(permits);
      setWorkSummary(buildWorkSummary(permits));
      setRiskSummary(await buildRiskSummary(permits));
    } else {
      setTodayLog(null);
      setAckDone(false);
      setDayPermits([]);
    }

    // Full GPS is owned by WorkerGlobalGps (checked-in workers / on-site managers only).
  }, [user, profile]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // Incomplete day: force signature before work continues
    if (diagnosticsOnly) return;
    if (isCheckedIn && !ackDone) {
      setPendingEntry(false);
      setAckOpen(true);
    }
  }, [isCheckedIn, ackDone, diagnosticsOnly]);

  // Fresh high-accuracy probe for check-in. Stale coarse GPS (60s cache) was
  // showing workers as outside while they stood on the pad. Watch briefly then stop.
  useEffect(() => {
    if (!projectId || gpsTracking) return;
    if (!diagnosticsOnly && isCheckedIn) return;
    if (!("geolocation" in navigator)) return;
    let cancelled = false;
    let watchId: number | null = null;
    const apply = (pos: GeolocationPosition) => {
      if (cancelled) return;
      const next = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };
      setProbeFix((prev) => {
        if (!prev || next.accuracy <= prev.accuracy) return next;
        return prev;
      });
    };
    navigator.geolocation.getCurrentPosition(apply, () => undefined, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15_000,
    });
    watchId = navigator.geolocation.watchPosition(apply, () => undefined, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15_000,
    });
    const stop = window.setTimeout(() => {
      if (watchId != null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
    }, 12_000);
    return () => {
      cancelled = true;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      window.clearTimeout(stop);
    };
  }, [projectId, isCheckedIn, gpsTracking, probeNonce, diagnosticsOnly]);

  const ensureConsentAndGps = async () => {
    const { setTrackingConsent } = await import("@/lib/tracking/locationTracker");
    const { resolveBanSubject } = await import("@/lib/tracking/resolveBanSubject");
    setTrackingConsent(true);
    if (!projectId) {
      toast.error("현장을 먼저 선택하세요");
      return false;
    }
    // DENY/ALLOW company match needs company_id on every track-location invoke.
    const ban = await resolveBanSubject(projectId, {
      phone: profile?.phone,
      userId: user?.id,
    });
    startGpsTracking({
      project_id: projectId,
      worker_id: workerId || ban.worker_id || null,
      worker_name: profile?.display_name || null,
      worker_phone: profile?.phone || null,
      company_id: ban.company_id || null,
      worker_role: "worker",
    });
    window.dispatchEvent(new Event("mobile:resume-gps-tracking"));
    return true;
  };

  const handleCheckIn = async () => {
    if (suspension) {
      toast.error(
        `출입 정지 상태입니다${suspension.reason ? ` · ${suspension.reason}` : ""}`,
      );
      return;
    }
    if (!withinCheckIn || !checkInFence) {
      const allow = checkInFence ? Math.round(checkInFence.radiusM) : SITE_CHECKIN_MIN_M;
      toast.error(`현장 반경 ${allow}m 이내에서만 출근할 수 있습니다`);
      return;
    }
    if (!workerId || !projectId) {
      toast.error("근로자 프로필(전화↔workers)을 찾을 수 없습니다. 관리자에게 등록을 요청하세요.");
      return;
    }
    if (!(await ensureConsentAndGps())) return;
    // Signature required before entry is written
    setPendingEntry(true);
    setAckWorkOk(false);
    setAckRiskOk(false);
    setAckPledgeOk(false);
    ackSigRef.current?.clear();
    setAckOpen(true);
  };

  const handleDailyAck = async () => {
    if (!ackWorkOk || !ackRiskOk || !ackPledgeOk) {
      toast.error("작업내용·위험요인·안전수칙 확인에 모두 체크해 주세요");
      return;
    }
    if (!ackSigRef.current || ackSigRef.current.isEmpty()) {
      toast.error("손가락으로 서명란에 서명해 주세요");
      return;
    }
    if (!workerId || !projectId) return;
    const signatureData = ackSigRef.current.toDataURL("image/png");
    if (!signatureData || signatureData.length < 100) {
      toast.error("서명이 유효하지 않습니다. 다시 서명해 주세요");
      return;
    }

    setBusy(true);
    try {
      let log = todayLog;
      if (!log || pendingEntry) {
        const { data, error } = await supabase.rpc("worker_gps_daily_lifecycle", {
          _action: "entry",
          _worker_id: workerId,
          _project_id: projectId,
          _lat: effectiveFix?.lat ?? null,
          _lng: effectiveFix?.lng ?? null,
          _accuracy: effectiveFix?.accuracy ?? null,
        });
        if (error) throw error;
        const res = data as any;
        if (res?.error) {
          if (res.error === "SUSPENDED") {
            throw new Error(
              `출입 정지 상태입니다${res.reason ? ` · ${res.reason}` : ""}`,
            );
          }
          throw new Error(res.message || res.error || "출근 기록 실패");
        }
        log = res?.log as EntryLog | undefined;
        if (!log?.id) throw new Error("출근 기록 응답이 비어 있습니다");
        setTodayLog(log);
      }

      const saved = await saveDailyWorkAck({
        projectId,
        workerId,
        userId: user?.id,
        workerName: profile?.display_name || "근로자",
        workerPhone: profile?.phone || "",
        entryLogId: log.id,
        permitIds: dayPermits.map((p) => p.id),
        workSummary,
        riskSummary,
        signatureData,
      });
      if ("error" in saved) throw new Error(saved.error);

      const { data, error } = await supabase.rpc("worker_gps_daily_lifecycle", {
        _action: "ack",
        _worker_id: workerId,
        _project_id: projectId,
      });
      if (error) throw error;
      const res = data as any;
      if (res?.error) throw new Error(res.message || res.error || "확인 저장 실패");
      const nextLog = res?.log as EntryLog | undefined;
      if (!nextLog?.id) throw new Error("확인 저장 응답이 비어 있습니다");
      setTodayLog(nextLog);
      setAckDone(true);
      setPendingEntry(false);
      setAckOpen(false);
      try {
        window.dispatchEvent(new Event("mobile:resume-gps-tracking"));
      } catch {
        /* ignore */
      }
      toast.success("서명 확인 완료 — 출근이 기록되었습니다");
    } catch (e: any) {
      toast.error(e?.message || "서명·출근 저장 실패");
    } finally {
      setBusy(false);
    }
  };

  const handleCheckOut = async () => {
    if (!ackDone) {
      toast.error("작업·위험 확인 서명 후에만 퇴근할 수 있습니다");
      setAckOpen(true);
      return;
    }
    if (!noAccident || !healthOk) {
      toast.error("무재해 서약과 건강상태 확인에 체크해야 퇴근할 수 있습니다");
      return;
    }
    if (!exitSigRef.current || exitSigRef.current.isEmpty()) {
      toast.error("퇴근 서명을 해 주세요");
      return;
    }
    if (!todayLog || !workerId || !projectId) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("worker_gps_daily_lifecycle", {
        _action: "exit",
        _worker_id: workerId,
        _project_id: projectId,
      });
      if (error) throw error;
      const res = data as any;
      if (res?.error) throw new Error(res.message || res.error || "퇴근 기록 실패");
      const log = res?.log as EntryLog | undefined;
      if (!log?.id) throw new Error("퇴근 기록 응답이 비어 있습니다");
      setTodayLog(log);
      setExitOpen(false);
      stopGpsTracking();
      try {
        window.dispatchEvent(new Event("mobile:worker-checked-out"));
      } catch {
        /* ignore */
      }
      toast.success(
        res?.already
          ? "이미 퇴근 처리되었습니다."
          : "퇴근이 기록되었습니다. GPS 추적을 종료합니다.",
      );
    } catch (e: any) {
      toast.error(e?.message || "퇴근 기록 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={
        embedded
          ? "bg-transparent"
          : "min-h-screen bg-gradient-to-b from-slate-100 via-sky-50 to-emerald-50 pb-24"
      }
    >
      {!embedded && (
        <header className="bg-slate-900 text-white p-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-white/10 flex items-center justify-center">
            {diagnosticsOnly ? <MapPin className="h-6 w-6" /> : <HardHat className="h-6 w-6" />}
          </div>
          <div className="flex-1">
            <div className="font-bold text-lg leading-tight">
              {diagnosticsOnly ? "위치 · GPS" : "일일 안전 출퇴근"}
            </div>
            <div className="text-xs opacity-80">
              {profile?.display_name || "근로자"} · {projectName || "현장 미선택"}
            </div>
          </div>
          <Button asChild variant="secondary" size="sm" className="h-8 text-xs">
            <Link to="/app/worker/today">오늘</Link>
          </Button>
        </header>
      )}

      <main className={embedded ? "p-3 space-y-3" : "p-4 space-y-4 max-w-lg mx-auto"}>
        {suspension && !diagnosticsOnly && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <div className="font-semibold">현장 출입 정지</div>
            <div className="text-xs mt-1 opacity-90">
              {suspension.kind === "permanent" || suspension.until.startsWith("9999")
                ? "영구"
                : `해제일: ${new Date(suspension.until).toLocaleString("ko-KR")}`}
              {suspension.reason ? ` · ${suspension.reason}` : ""}
            </div>
          </div>
        )}

        {!diagnosticsOnly && shouldShowHomeWorkStopCard(isCheckedIn) && (
          <section
            className="rounded-2xl border-2 border-destructive bg-destructive/10 p-4 space-y-2 shadow-sm"
            data-testid="worker-home-work-stop"
          >
            <div className="flex items-start gap-2">
              <OctagonAlert className="h-6 w-6 text-destructive shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-base font-bold text-destructive leading-tight">
                  위험하면 작업을 멈추세요
                </div>
                <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                  작업중지권·작업거부권. 익명 또는 실명으로 신고할 수 있습니다.
                  <br />
                  {WORK_STOP_LEGAL_CITE} · 불이익 금지
                </p>
              </div>
            </div>
            <Button
              asChild
              className="w-full h-12 bg-destructive hover:bg-destructive/90 text-destructive-foreground text-base font-semibold"
            >
              <Link to="/app/worker/work-stop">작업중지 요청</Link>
            </Button>
          </section>
        )}

        {(diagnosticsOnly || shouldShowHomeGpsCard(isCheckedIn)) && (
        <section className="rounded-2xl bg-white/80 backdrop-blur border border-slate-200 p-4 space-y-3 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <MapPin className="h-4 w-4 text-emerald-600" />
            {diagnosticsOnly ? "위치 · GPS" : "출근 위치"}
            {checkInFence
              ? ` · ${Math.round(checkInFence.radiusM)}m`
              : ` · ${SITE_CHECKIN_MIN_M}m`}
          </div>
          {diagnosticsOnly ? (
            <>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                <div>추적: {gpsTracking ? "ON" : "OFF"}</div>
                <div>
                  거리:{" "}
                  {!checkInFence
                    ? "현장 좌표 미설정"
                    : !effectiveFix
                      ? (gpsError ? "GPS 오류" : "GPS 대기…")
                      : `${Math.round(distanceM!)}m`}
                </div>
                <div className="col-span-2">
                  좌표:{" "}
                  {effectiveFix
                    ? `${effectiveFix.lat.toFixed(5)}, ${effectiveFix.lng.toFixed(5)} (±${Math.round(effectiveFix.accuracy)}m)`
                    : "대기"}
                </div>
                <div className="col-span-2">
                  현장 기준:{" "}
                  {checkInFence
                    ? `${checkInFence.lat.toFixed(5)}, ${checkInFence.lng.toFixed(5)} (${
                        checkInFence.source === "site_map"
                          ? "현장맵"
                          : checkInFence.source === "site_union"
                            ? "현장맵+주소"
                            : "주소핀"
                      })`
                    : "현장맵 지오레프 또는 projects.site_lat/lng 필요"}
                </div>
                {gpsError && (
                  <div className="col-span-2 text-destructive">GPS: {gpsError}</div>
                )}
              </div>
              <Badge variant={withinCheckIn ? "default" : "secondary"}>
                {!checkInFence
                  ? "현장 좌표 없음 — 출근 불가"
                  : withinCheckIn
                    ? `반경 ${Math.round(checkInFence.radiusM)}m 이내`
                    : "반경 밖"}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setProbeFix(null);
                  setProbeNonce((n) => n + 1);
                }}
              >
                내 위치 다시 잡기
              </Button>
              {!gpsTracking && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={async () => {
                    const { setTrackingConsent } = await import("@/lib/tracking/locationTracker");
                    setTrackingConsent(true);
                    try {
                      window.dispatchEvent(new Event("mobile:resume-gps-tracking"));
                    } catch { /* ignore */ }
                  }}
                >
                  GPS 추적 다시 평가
                </Button>
              )}
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                출근 후에는 홈에서 GPS 카드를 숨깁니다. 추적은 백그라운드에서 유지됩니다.
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <Badge variant={withinCheckIn ? "default" : "secondary"}>
                  {!checkInFence
                    ? "현장 좌표 없음 — 출근 불가"
                    : !effectiveFix
                      ? (gpsError ? "GPS 오류" : "위치 확인 중…")
                      : withinCheckIn
                        ? "반경 안 — 출근 가능"
                        : "반경 밖 — 출근 불가"}
                </Badge>
                {effectiveFix && distanceM != null && checkInFence && (
                  <span className="text-xs text-slate-500">{Math.round(distanceM)}m</span>
                )}
              </div>
              {gpsError && (
                <p className="text-xs text-destructive">GPS: {gpsError}</p>
              )}
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setProbeFix(null);
                  setProbeNonce((n) => n + 1);
                }}
              >
                위치 다시 잡기
              </Button>
              <Button asChild size="sm" variant="ghost" className="w-full text-xs">
                <Link to="/app/worker/location">위치·GPS 자세히</Link>
              </Button>
            </>
          )}
        </section>
        )}

        {!diagnosticsOnly && (
        <section className="rounded-2xl bg-white/80 border border-slate-200 p-4 space-y-3 shadow-sm">
          <div className="text-sm font-semibold text-slate-800">오늘 상태</div>
          <ol className="space-y-2 text-sm">
            <li className={isCheckedIn || checkedOut ? "text-emerald-700" : "text-slate-500"}>
              1. 출근 {todayLog?.entry_at ? `· ${new Date(todayLog.entry_at).toLocaleTimeString("ko-KR")}` : ""}
            </li>
            <li className={ackDone ? "text-emerald-700" : "text-slate-500"}>
              2. 작업·위험 확인 서명 {ackDone ? "완료" : "필수"}
              {dayPermits.length > 0 && !ackDone ? ` · 허가서 ${dayPermits.length}건` : ""}
            </li>
            <li className={checkedOut ? "text-emerald-700" : "text-slate-500"}>
              3. 무재해 서약 · 퇴근 {todayLog?.exit_at ? `· ${new Date(todayLog.exit_at).toLocaleTimeString("ko-KR")}` : ""}
            </li>
          </ol>

          <div className="flex flex-col gap-2 pt-1">
            {!isCheckedIn && !checkedOut && (
              <Button
                className="h-12 gap-2"
                disabled={!withinCheckIn || busy || !workerId || !!suspension}
                onClick={() => void handleCheckIn()}
              >
                <LogIn className="h-4 w-4" />
                {suspension ? "출입 정지됨" : "출근하기"}
              </Button>
            )}
            {isCheckedIn && (
              <>
                {!ackDone && (
                  <Button variant="outline" className="h-11 gap-2" onClick={() => setAckOpen(true)}>
                    <FileSignature className="h-4 w-4" />
                    작업·위험 확인 서명
                  </Button>
                )}
                <Button
                  variant="destructive"
                  className="h-12 gap-2"
                  disabled={busy || !ackDone}
                  onClick={() => {
                    if (!ackDone) {
                      toast.error("작업·위험 확인 서명 후에만 퇴근할 수 있습니다");
                      setAckOpen(true);
                      return;
                    }
                    setNoAccident(false);
                    setHealthOk(false);
                    exitSigRef.current?.clear();
                    setExitOpen(true);
                  }}
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
        )}
      </main>

      <Dialog
        open={ackOpen}
        onOpenChange={(open) => {
          if (!open && pendingEntry && !isCheckedIn) {
            setPendingEntry(false);
          }
          // Incomplete checked-in day cannot dismiss without signature
          if (!open && isCheckedIn && !ackDone) {
            toast.error("서명 확인 없이 작업을 진행할 수 없습니다");
            return;
          }
          setAckOpen(open);
        }}
      >
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{pendingEntry ? "출근 · 작업·위험 확인 서명" : "오늘 작업·위험 확인"}</DialogTitle>
            <DialogDescription>
              배정된 허가서를 확인하고 손글씨로 서명해야 {pendingEntry ? "출근이 기록됩니다" : "작업을 이어갈 수 있습니다"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-md bg-slate-50 p-3 border">
              <div className="font-medium text-xs text-muted-foreground mb-1">작업 내용</div>
              <p className="whitespace-pre-wrap text-sm">{workSummary}</p>
            </div>
            <div className="rounded-md bg-slate-50 p-3 border">
              <div className="font-medium text-xs text-muted-foreground mb-1">위험성평가 요지</div>
              <p className="whitespace-pre-wrap text-sm">{riskSummary}</p>
            </div>
            <label className="flex items-start gap-2">
              <Checkbox checked={ackWorkOk} onCheckedChange={(v) => setAckWorkOk(v === true)} />
              <span>오늘 작업 내용을 확인했습니다.</span>
            </label>
            <label className="flex items-start gap-2">
              <Checkbox checked={ackRiskOk} onCheckedChange={(v) => setAckRiskOk(v === true)} />
              <span>위험요인·대책을 확인했습니다.</span>
            </label>
            <label className="flex items-start gap-2">
              <Checkbox checked={ackPledgeOk} onCheckedChange={(v) => setAckPledgeOk(v === true)} />
              <span>{WORK_ACK_PLEDGE}</span>
            </label>
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="font-medium text-xs">전자서명 *</div>
                <Button type="button" variant="ghost" size="sm" onClick={() => ackSigRef.current?.clear()}>
                  지우기
                </Button>
              </div>
              <div className="border-2 rounded-md bg-background">
                <ResponsiveSignaturePad ref={ackSigRef} height={150} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">손가락으로 위 영역에 서명해 주세요.</p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row">
            {pendingEntry && !isCheckedIn ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setPendingEntry(false);
                  setAckOpen(false);
                }}
              >
                취소
              </Button>
            ) : null}
            <Button disabled={busy} onClick={() => void handleDailyAck()}>
              {pendingEntry ? "서명 후 출근" : "서명 · 확인"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={exitOpen} onOpenChange={setExitOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>일일 무재해 서약서 및 건강상태 확인</DialogTitle>
            <DialogDescription>퇴근 전 필수 서약·서명입니다. (회사 QR 퇴근과 동일 수준)</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <label className="flex items-start gap-2">
              <Checkbox checked={noAccident} onCheckedChange={(v) => setNoAccident(v === true)} />
              <span>{NO_ACCIDENT_PLEDGE}</span>
            </label>
            <label className="flex items-start gap-2">
              <Checkbox checked={healthOk} onCheckedChange={(v) => setHealthOk(v === true)} />
              <span>{HEALTH_PLEDGE}</span>
            </label>
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="font-medium text-xs">퇴근 서명 *</div>
                <Button type="button" variant="ghost" size="sm" onClick={() => exitSigRef.current?.clear()}>
                  지우기
                </Button>
              </div>
              <div className="border-2 rounded-md bg-background">
                <ResponsiveSignaturePad ref={exitSigRef} height={140} />
              </div>
            </div>
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
