/**
 * Starts global GPS for the worker shell while a project is selected.
 * Mount once under /app/worker AuthGuard — survives page navigation.
 */
import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemRealtime } from "@/providers/SystemRealtimeProvider";
import { supabase } from "@/integrations/supabase/client";
import { hasTrackingConsent } from "@/lib/tracking/locationTracker";

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
    if (!hasTrackingConsent()) return;

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
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", boot);

    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", boot);
    };
  }, [user, profile?.display_name, profile?.phone, startGpsTracking, stopGpsTracking]);

  useEffect(() => () => stopGpsTracking(), [stopGpsTracking]);

  // Quiet marker for debugging — no UI chrome
  if (import.meta.env.DEV && gpsTracking) {
    return <span className="sr-only" data-gps="on" />;
  }
  return null;
}
