/**
 * Starts global GPS for the worker shell while a project is selected.
 * Mount once under /app/worker AuthGuard — survives page navigation.
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

const PROJECT_KEY = "selectedProjectId";

export default function WorkerGlobalGps() {
  const { user, profile } = useAuth();
  const { startGpsTracking, stopGpsTracking, gpsTracking } = useSystemRealtime();
  const workerIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user) {
      stopGpsTracking();
      return;
    }
    normalizeTrackingConsentStorage();
    // Profile location consent (DB) should unlock local GPS gate
    if (profile?.agreed_to_location === true && !hasTrackingConsent()) {
      setTrackingConsent(true);
    }
    if (!hasTrackingConsent() && profile?.agreed_to_location !== true) return;

    let cancelled = false;

    const boot = async () => {
      const projectId = localStorage.getItem(PROJECT_KEY);
      if (!projectId) {
        stopGpsTracking();
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
      // Start even without workers-row match — check-in still needs worker_id later
      startGpsTracking({
        project_id: projectId,
        worker_id: workerId,
        worker_name: profile?.display_name || null,
        worker_phone: profile?.phone || null,
      });
    };

    void boot();

    const onStorage = (e: StorageEvent) => {
      if (e.key === PROJECT_KEY) void boot();
    };
    const onProjectChanged = () => void boot();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", boot);
    window.addEventListener("mobile:project-changed", onProjectChanged);

    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", boot);
      window.removeEventListener("mobile:project-changed", onProjectChanged);
    };
  }, [user, profile?.display_name, profile?.phone, profile?.agreed_to_location, startGpsTracking, stopGpsTracking]);

  useEffect(() => () => stopGpsTracking(), [stopGpsTracking]);

  // Quiet marker for debugging — no UI chrome
  if (import.meta.env.DEV && gpsTracking) {
    return <span className="sr-only" data-gps="on" />;
  }
  return null;
}
