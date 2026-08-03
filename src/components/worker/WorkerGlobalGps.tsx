/**
 * Starts global GPS for the worker shell while a project is selected.
 * Mount once under /app/worker AuthGuard — survives page navigation.
 *
 * Never re-request OS permissions on window focus (that caused install-time loops).
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

const PROJECT_KEY = "selectedProjectId";

export default function WorkerGlobalGps() {
  const { user, profile, roles } = useAuth();
  const { startGpsTracking, stopGpsTracking, gpsTracking } = useSystemRealtime();
  const workerIdRef = useRef<string | null>(null);
  const lastKeyRef = useRef<string | null>(null);

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
    // Wait until explicit native permission onboarding finished (avoids focus/dialog storms)
    if (!hasCompletedNativePermissions()) return;

    let cancelled = false;

    const ensureProject = async () => {
      let projectId = localStorage.getItem(PROJECT_KEY);
      if (projectId) return projectId;
      const isMaster = (roles || []).some((r) => r.toLowerCase() === "master");
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

    const boot = async () => {
      const projectId = await ensureProject();
      if (!projectId) {
        stopGpsTracking();
        lastKeyRef.current = null;
        return;
      }

      let workerId = workerIdRef.current;
      if (!workerId && profile?.phone) {
        const digits = profile.phone.replace(/\D/g, "");
        const { data } = await supabase
          .from("workers")
          .select("id, phone")
          .eq("project_id", projectId)
          .eq("is_active", true)
          .limit(50);
        const match = (data || []).find(
          (w) => (w.phone || "").replace(/\D/g, "") === digits,
        );
        workerId = match?.id || null;
        workerIdRef.current = workerId;
      }

      if (cancelled) return;

      const key = `${projectId}:${workerId || ""}`;
      if (gpsTracking && lastKeyRef.current === key) return;
      lastKeyRef.current = key;

      startGpsTracking({
        project_id: projectId,
        worker_id: workerId,
        worker_name: profile?.display_name || null,
        worker_phone: profile?.phone || null,
      });
    };

    void boot();

    const onStorage = (e: StorageEvent) => {
      if (e.key === PROJECT_KEY) {
        lastKeyRef.current = null;
        void boot();
      }
    };
    const onProjectChanged = () => {
      lastKeyRef.current = null;
      void boot();
    };
    window.addEventListener("storage", onStorage);
    // Intentionally NO window "focus" → requestPermissions loop
    window.addEventListener("mobile:project-changed", onProjectChanged);

    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("mobile:project-changed", onProjectChanged);
    };
  }, [
    user,
    roles,
    profile?.display_name,
    profile?.phone,
    profile?.agreed_to_location,
    startGpsTracking,
    stopGpsTracking,
    gpsTracking,
  ]);

  useEffect(() => () => stopGpsTracking(), [stopGpsTracking]);

  if (import.meta.env.DEV && gpsTracking) {
    return <span className="sr-only" data-gps="on" />;
  }
  return null;
}
