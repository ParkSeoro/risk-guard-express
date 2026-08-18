/**
 * Global GPS for /app/worker shell — one owner for start/stop.
 *
 * Policy:
 * - Worker: full tracking only while checked in today (open entry log).
 * - Manager: full tracking only when currently inside the site resume fence.
 * - Platform master: same fence by default. Opt-in "현장 외 알람 테스트"
 *   skips the probe/auto-stop and suppresses worker_last_positions.
 */
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemRealtime } from "@/providers/SystemRealtimeProvider";
import { supabase } from "@/integrations/supabase/client";
import {
  hasTrackingConsent,
  normalizeTrackingConsentStorage,
  setTrackingConsent,
} from "@/lib/tracking/locationTracker";
import { hasCompletedNativePermissions, isNativeApp } from "@/lib/native/isNativeApp";
import {
  resolveSiteTrackingFence,
  isInsideResumeFence,
} from "@/lib/tracking/siteTrackBounds";
import { clearStickyDangerAlert } from "@/lib/tracking/dangerAlertSticky";
import {
  isPlatformMaster,
  MASTER_OFFSITE_ALARM_TEST_EVENT,
  readMasterOffsiteAlarmTest,
} from "@/lib/tracking/masterOffsiteAlarmTest";
import { isManagerMobileRole } from "@/lib/mobileShell";
import type { MobileRole } from "@/hooks/useMobileAccess";
import { seoulDayRange, todaySeoulDate } from "@/lib/dailyWorkAck";
import { isTrackLocationIdentityDenied } from "@/lib/tracking/trackLocationClient";
import { useSetGpsUi, type GpsBlockReason } from "@/lib/tracking/gpsStatusUi";
import {
  gpsStatusReportPayload,
  useReportWorkerGpsStatus,
} from "@/lib/tracking/reportGpsStatus";
import {
  ACTIVE_PROJECT_CHANGED_EVENT,
  isActiveProjectStorageKey,
  readActiveProjectId,
  writeActiveProjectId,
} from "@/lib/activeProject";

export type { GpsBlockReason };

/** Sets header chip when WorkerGlobalGps is not mounted (no consent). */
export function GpsBlockBadge({ reason }: { reason: GpsBlockReason }) {
  const setUi = useSetGpsUi();
  useEffect(() => {
    setUi({ tracking: false, block: reason });
    return () => setUi({ tracking: false, block: null });
  }, [reason, setUi]);
  useReportWorkerGpsStatus(reason ?? undefined);
  return null;
}

export default function WorkerGlobalGps() {
  const { user, profile, roles, hasRole } = useAuth();
  const { startGpsTracking, stopGpsTracking, gpsTracking, gpsSuspended, gpsError } = useSystemRealtime();
  const setGpsUi = useSetGpsUi();
  const workerIdRef = useRef<string | null>(null);
  const lastKeyRef = useRef<string | null>(null);
  const [gpsBlockReason, setGpsBlockReason] = useState<GpsBlockReason>(null);

  useEffect(() => {
    if (!user) {
      stopGpsTracking();
      lastKeyRef.current = null;
      setGpsBlockReason(null);
      return;
    }
    normalizeTrackingConsentStorage();
    if (profile?.agreed_to_location === true && !hasTrackingConsent()) {
      setTrackingConsent(true);
    }
    if (!hasTrackingConsent() && profile?.agreed_to_location !== true) {
      setGpsBlockReason("no_consent");
      return;
    }
    // Native onboarding flag is only required inside Capacitor (PWA/web must not soft-lock GPS).
    if (isNativeApp() && !hasCompletedNativePermissions()) {
      setGpsBlockReason("no_permission");
      return;
    }

    let cancelled = false;
    let resumeTimer: number | null = null;

    const clearResumePoll = () => {
      if (resumeTimer != null) {
        window.clearInterval(resumeTimer);
        resumeTimer = null;
      }
    };

    const ensureProject = async () => {
      let projectId = readActiveProjectId();
      if (projectId) return projectId;
      const master = isPlatformMaster(hasRole, roles);
      try {
        let list: { id: string }[] = [];
        if (master) {
          const { data } = await supabase
            .from("projects")
            .select("id")
            .eq("is_deleted", false)
            .order("created_at", { ascending: false })
            .limit(5);
          list = data || [];
        } else {
          const { data } = await supabase
            .from("project_members")
            .select("projects(id, is_deleted)")
            .eq("user_id", user.id);
          list = (data || [])
            .map((m: any) => m.projects)
            .filter((p: any) => p && !p.is_deleted);
        }
        if (list[0]?.id) {
          writeActiveProjectId(list[0].id);
          return list[0].id;
        }
      } catch {
        /* ignore */
      }
      return null;
    };

    const resolveIsManager = async (projectId: string): Promise<boolean> => {
      if (isPlatformMaster(hasRole, roles)) {
        return true;
      }
      try {
        const { data } = await supabase
          .from("project_members")
          .select("role_new")
          .eq("user_id", user.id)
          .eq("project_id", projectId)
          .maybeSingle();
        const role = ((data as any)?.role_new || "worker") as MobileRole;
        return isManagerMobileRole(role, false);
      } catch {
        return false;
      }
    };

    const resolveWorkerId = async (projectId: string): Promise<string | null> => {
      if (workerIdRef.current) return workerIdRef.current;
      if (!profile?.phone) return null;
      const { lookupWorkerBanFields } = await import("@/lib/tracking/resolveBanSubject");
      const match = await lookupWorkerBanFields(projectId, profile.phone);
      workerIdRef.current = match.worker_id;
      return workerIdRef.current;
    };

    const hasOpenCheckIn = async (projectId: string, workerId: string | null): Promise<boolean> => {
      if (!workerId) return false;
      const { start, end } = seoulDayRange(todaySeoulDate());
      const { data } = await supabase
        .from("worker_entry_logs")
        .select("id")
        .eq("project_id", projectId)
        .eq("worker_id", workerId)
        .is("exit_at", null)
        .gte("entry_at", start)
        .lte("entry_at", end)
        .limit(1);
      return ((data as any[]) || []).length > 0;
    };

    const probeInsideSite = async (projectId: string): Promise<boolean> => {
      if (!("geolocation" in navigator)) return false;
      const fence = await resolveSiteTrackingFence(projectId);
      if (!fence) return false;
      return await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            resolve(
              isInsideResumeFence(
                fence,
                pos.coords.latitude,
                pos.coords.longitude,
                pos.coords.accuracy,
              ),
            );
          },
          () => resolve(false),
          { enableHighAccuracy: true, maximumAge: 8_000, timeout: 15_000 },
        );
      });
    };

    const startForProject = async (projectId: string) => {
      const workerId = await resolveWorkerId(projectId);
      if (cancelled) return;
      const { resolveBanSubject } = await import("@/lib/tracking/resolveBanSubject");
      const ban = await resolveBanSubject(projectId, {
        phone: profile?.phone,
        userId: user?.id,
      });
      if (cancelled) return;
      const offsiteAlarmTest =
        isPlatformMaster(hasRole, roles) && readMasterOffsiteAlarmTest();
      const key = `${projectId}:${workerId || ban.worker_id || ""}:${ban.company_id || ""}:${offsiteAlarmTest ? "test" : "fence"}`;
      if (lastKeyRef.current === key) return;
      lastKeyRef.current = key;
      const roleHint =
        (isPlatformMaster(hasRole, roles) && "master") ||
        (roles || []).find((r) => r && r !== "master") ||
        null;
      setGpsBlockReason(null);
      startGpsTracking({
        project_id: projectId,
        worker_id: workerId || ban.worker_id || null,
        worker_name: profile?.display_name || null,
        worker_phone: profile?.phone || null,
        company_id: ban.company_id || null,
        worker_role: roleHint,
        suppress_last_position: offsiteAlarmTest,
      });
    };

    const watchResumeNearSite = (projectId: string) => {
      clearResumePoll();
      const tick = () => {
        void probeInsideSite(projectId).then((inside) => {
          if (!inside || cancelled) return;
          clearStickyDangerAlert();
          clearResumePoll();
          lastKeyRef.current = null;
          void startForProject(projectId);
        });
      };
      // Off-site: do not hammer GPS (home OS icon). One cold probe, then 2 min.
      // Foreground return also re-probes via visibility listener below.
      resumeTimer = window.setInterval(tick, 120_000);
      window.setTimeout(tick, 3_000);
    };

    const boot = async () => {
      clearResumePoll();
      const projectId = await ensureProject();
      if (!projectId) {
        stopGpsTracking();
        lastKeyRef.current = null;
        return;
      }

      const isManager = await resolveIsManager(projectId);
      if (cancelled) return;

      // Managers: only while inside the site resume fence.
      // Master may opt into off-site alarm testing (no last-position write).
      if (isManager) {
        if (isPlatformMaster(hasRole, roles) && readMasterOffsiteAlarmTest()) {
          clearStickyDangerAlert();
          await startForProject(projectId);
          return;
        }
        const inside = await probeInsideSite(projectId);
        if (cancelled) return;
        if (inside) {
          clearStickyDangerAlert();
          await startForProject(projectId);
        } else {
          setGpsBlockReason("fence_probe_failed");
          clearStickyDangerAlert();
          if (lastKeyRef.current) {
            // Tracker already owns the session (possibly suspended). Don't tear it down.
            return;
          }
          stopGpsTracking();
          lastKeyRef.current = null;
          watchResumeNearSite(projectId);
        }
        return;
      }

      // Worker: tracking only while checked in
      const workerId = await resolveWorkerId(projectId);
      const checkedIn = await hasOpenCheckIn(projectId, workerId);
      if (cancelled) return;
      if (checkedIn) {
        clearStickyDangerAlert();
        await startForProject(projectId);
      } else {
        setGpsBlockReason("no_checkin");
        stopGpsTracking();
        clearStickyDangerAlert();
        lastKeyRef.current = null;
      }
    };

    void boot();

    const onStorage = (e: StorageEvent) => {
      if (isActiveProjectStorageKey(e.key)) {
        lastKeyRef.current = null;
        workerIdRef.current = null;
        void boot();
      }
    };
    const onProjectChanged = () => {
      lastKeyRef.current = null;
      workerIdRef.current = null;
      void boot();
    };
    /** Check-in / manual resume — re-evaluate start rules. */
    const onResumeTracking = () => {
      lastKeyRef.current = null;
      void boot();
    };
    /** Auto-stop after leave-site: tracker stays in low-power resume; do not tear it down. */
    const onAutoStopped = () => {
      setGpsBlockReason("fence_probe_failed");
      clearStickyDangerAlert();
    };
    const onCheckedOut = () => {
      clearResumePoll();
      lastKeyRef.current = null;
      setGpsBlockReason("no_checkin");
      stopGpsTracking();
      clearStickyDangerAlert();
    };

    const onVisResume = () => {
      if (document.visibilityState !== "visible") return;
      void boot();
    };

    const onOffsiteTest = () => {
      lastKeyRef.current = null;
      void boot();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(ACTIVE_PROJECT_CHANGED_EVENT, onProjectChanged);
    window.addEventListener("mobile:resume-gps-tracking", onResumeTracking);
    window.addEventListener("mobile:gps-auto-stopped", onAutoStopped);
    window.addEventListener("mobile:worker-checked-out", onCheckedOut);
    window.addEventListener(MASTER_OFFSITE_ALARM_TEST_EVENT, onOffsiteTest);
    document.addEventListener("visibilitychange", onVisResume);

    return () => {
      cancelled = true;
      clearResumePoll();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(ACTIVE_PROJECT_CHANGED_EVENT, onProjectChanged);
      window.removeEventListener("mobile:resume-gps-tracking", onResumeTracking);
      window.removeEventListener("mobile:gps-auto-stopped", onAutoStopped);
      window.removeEventListener("mobile:worker-checked-out", onCheckedOut);
      window.removeEventListener(MASTER_OFFSITE_ALARM_TEST_EVENT, onOffsiteTest);
      document.removeEventListener("visibilitychange", onVisResume);
    };
  }, [
    user,
    roles,
    hasRole,
    profile?.display_name,
    profile?.phone,
    profile?.agreed_to_location,
    startGpsTracking,
    stopGpsTracking,
  ]);

  useEffect(() => () => stopGpsTracking(), [stopGpsTracking]);

  // Clear badge once tracking is actually on (covers race / resume)
  useEffect(() => {
    if (isTrackLocationIdentityDenied(gpsError)) {
      setGpsBlockReason("identity_mismatch");
      return;
    }
    if (gpsTracking && !gpsSuspended) setGpsBlockReason(null);
  }, [gpsTracking, gpsSuspended, gpsError]);

  const reportPayload = gpsStatusReportPayload({
    tracking: gpsTracking,
    suspended: gpsSuspended,
    block: gpsBlockReason,
  });
  useReportWorkerGpsStatus(reportPayload);

  useEffect(() => {
    setGpsUi({
      tracking: gpsTracking && !gpsSuspended && gpsBlockReason !== "identity_mismatch",
      block:
        gpsBlockReason === "identity_mismatch"
          ? "identity_mismatch"
          : gpsSuspended
            ? "fence_probe_failed"
            : gpsTracking
              ? null
              : gpsBlockReason,
    });
    return () => setGpsUi({ tracking: false, block: null });
  }, [gpsTracking, gpsSuspended, gpsBlockReason, setGpsUi]);

  return null;
}
