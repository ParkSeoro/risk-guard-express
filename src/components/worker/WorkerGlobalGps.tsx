/**
 * Global GPS for /app/worker shell — one owner for start/stop.
 *
 * Policy (no offsite-pause flag):
 * - Worker: full tracking only while checked in today (open entry log).
 * - Manager/master: full tracking only when currently inside the site resume fence.
 * Leave-site stops tracking; managers poll occasionally to resume when back on site.
 * Workers resume on next check-in (mobile:resume-gps-tracking).
 */
import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemRealtime } from "@/providers/SystemRealtimeProvider";
import { supabase } from "@/integrations/supabase/client";
import {
  hasTrackingConsent,
  normalizeTrackingConsentStorage,
  setTrackingConsent,
} from "@/lib/tracking/locationTracker";
import { hasCompletedNativePermissions } from "@/lib/native/isNativeApp";
import {
  resolveSiteTrackingFence,
  isInsideResumeFence,
} from "@/lib/tracking/siteTrackBounds";
import { clearStickyDangerAlert } from "@/lib/tracking/dangerAlertSticky";
import { isManagerMobileRole } from "@/lib/mobileShell";
import type { MobileRole } from "@/hooks/useMobileAccess";
import { todaySeoulDate } from "@/lib/dailyWorkAck";

const PROJECT_KEY = "selectedProjectId";

export default function WorkerGlobalGps() {
  const { user, profile, roles, hasRole } = useAuth();
  const { startGpsTracking, stopGpsTracking, gpsTracking } = useSystemRealtime();
  const workerIdRef = useRef<string | null>(null);
  const lastKeyRef = useRef<string | null>(null);
  const managerRef = useRef(false);

  useEffect(() => {
    if (!user) {
      stopGpsTracking();
      lastKeyRef.current = null;
      return;
    }
    normalizeTrackingConsentStorage();
    if (profile?.agreed_to_location === true && !hasTrackingConsent()) {
      setTrackingConsent(true);
    }
    if (!hasTrackingConsent() && profile?.agreed_to_location !== true) return;
    if (!hasCompletedNativePermissions()) return;

    let cancelled = false;
    let resumeTimer: number | null = null;

    const clearResumePoll = () => {
      if (resumeTimer != null) {
        window.clearInterval(resumeTimer);
        resumeTimer = null;
      }
    };

    const ensureProject = async () => {
      let projectId = localStorage.getItem(PROJECT_KEY);
      if (projectId) return projectId;
      const isMaster = hasRole("master") || (roles || []).some((r) => r.toLowerCase() === "master");
      try {
        let list: { id: string }[] = [];
        if (isMaster) {
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
          localStorage.setItem(PROJECT_KEY, list[0].id);
          window.dispatchEvent(new Event("mobile:project-changed"));
          return list[0].id;
        }
      } catch {
        /* ignore */
      }
      return null;
    };

    const resolveIsManager = async (projectId: string): Promise<boolean> => {
      if (hasRole("master") || (roles || []).some((r) => String(r).toLowerCase() === "master")) {
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
      const digits = profile.phone.replace(/\D/g, "");
      const { data } = await supabase
        .from("workers")
        .select("id, phone")
        .eq("project_id", projectId)
        .eq("is_active", true)
        .limit(50);
      const match = (data || []).find((w) => (w.phone || "").replace(/\D/g, "") === digits);
      workerIdRef.current = match?.id || null;
      return workerIdRef.current;
    };

    const hasOpenCheckIn = async (projectId: string, workerId: string | null): Promise<boolean> => {
      if (!workerId) return false;
      const day = todaySeoulDate();
      const { data } = await supabase
        .from("worker_entry_logs")
        .select("id")
        .eq("project_id", projectId)
        .eq("worker_id", workerId)
        .is("exit_at", null)
        .gte("entry_at", `${day}T00:00:00`)
        .lte("entry_at", `${day}T23:59:59.999`)
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
              isInsideResumeFence(fence, pos.coords.latitude, pos.coords.longitude),
            );
          },
          () => resolve(false),
          { enableHighAccuracy: false, maximumAge: 30_000, timeout: 12_000 },
        );
      });
    };

    const startForProject = async (projectId: string) => {
      const workerId = await resolveWorkerId(projectId);
      if (cancelled) return;
      const key = `${projectId}:${workerId || ""}`;
      if (lastKeyRef.current === key) return;
      lastKeyRef.current = key;
      startGpsTracking({
        project_id: projectId,
        worker_id: workerId,
        worker_name: profile?.display_name || null,
        worker_phone: profile?.phone || null,
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
      // Do not probe immediately after leave — wait one interval to avoid toast loops.
      resumeTimer = window.setInterval(tick, 60_000);
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
      managerRef.current = isManager;

      if (isManager) {
        const inside = await probeInsideSite(projectId);
        if (cancelled) return;
        if (inside) {
          clearStickyDangerAlert();
          await startForProject(projectId);
        } else {
          stopGpsTracking();
          clearStickyDangerAlert();
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
        stopGpsTracking();
        clearStickyDangerAlert();
        lastKeyRef.current = null;
      }
    };

    void boot();

    const onStorage = (e: StorageEvent) => {
      if (e.key === PROJECT_KEY) {
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
    /** Auto-stop after leave-site: managers may poll to resume; workers wait for check-in. */
    const onAutoStopped = (ev: Event) => {
      const pid =
        (ev as CustomEvent)?.detail?.projectId || localStorage.getItem(PROJECT_KEY);
      if (!pid) return;
      lastKeyRef.current = null;
      if (managerRef.current) {
        stopGpsTracking();
        clearStickyDangerAlert();
        watchResumeNearSite(pid);
      }
    };
    const onCheckedOut = () => {
      clearResumePoll();
      lastKeyRef.current = null;
      stopGpsTracking();
      clearStickyDangerAlert();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("mobile:project-changed", onProjectChanged);
    window.addEventListener("mobile:resume-gps-tracking", onResumeTracking);
    window.addEventListener("mobile:gps-auto-stopped", onAutoStopped as EventListener);
    window.addEventListener("mobile:worker-checked-out", onCheckedOut);

    return () => {
      cancelled = true;
      clearResumePoll();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("mobile:project-changed", onProjectChanged);
      window.removeEventListener("mobile:resume-gps-tracking", onResumeTracking);
      window.removeEventListener("mobile:gps-auto-stopped", onAutoStopped as EventListener);
      window.removeEventListener("mobile:worker-checked-out", onCheckedOut);
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

  if (import.meta.env.DEV && gpsTracking) {
    return <span className="sr-only" data-gps="on" />;
  }
  return null;
}
