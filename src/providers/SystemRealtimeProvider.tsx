/**
 * Global realtime + push + GPS tracking context.
 * GPS is owned here (not page-local) so worker navigation never stops the tracker.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import PushNotificationBridge from "@/components/PushNotificationBridge";
import type { TrackingIdentity } from "@/lib/tracking/locationTracker";
import { resolveSiteTrackingFence } from "@/lib/tracking/siteTrackBounds";
import { clearStickyDangerAlert } from "@/lib/tracking/dangerAlertSticky";
import { toast } from "sonner";

export type GpsFix = {
  lat: number;
  lng: number;
  accuracy: number;
  at: number;
  /** Device raw GPS — site-fence / leave-site must use this, not calibrated. */
  raw_lat?: number;
  raw_lng?: number;
  /** preview = local watch; fix = after track-location. Sirens use preview hysteresis + fix veto. */
  kind?: "preview" | "fix";
  zone_id?: string | null;
  restricted_zone_id?: string | null;
  zone_name?: string | null;
  zone_type?: string | null;
  event_type?: string | null;
  ignored?: string | null;
};

type ZoneEventPayload = {
  id?: string;
  project_id?: string;
  zone_id?: string;
  restricted_zone_id?: string;
  zone_name?: string;
  event_type?: string;
  worker_name?: string;
  worker_phone?: string | null;
  worker_qr_id?: string | null;
  created_at?: string;
};

type SystemRealtimeValue = {
  unreadNotifications: number;
  lastZoneEvent: ZoneEventPayload | null;
  gpsTracking: boolean;
  lastGpsFix: GpsFix | null;
  /** Low-power off-site wait — session alive, not sending (F-03). */
  gpsSuspended: boolean;
  /** Last geolocation / track-location error message (null when healthy). */
  gpsError: string | null;
  startGpsTracking: (identity: TrackingIdentity) => void;
  stopGpsTracking: () => void;
};

const SystemRealtimeContext = createContext<SystemRealtimeValue | null>(null);

export function useSystemRealtime() {
  const ctx = useContext(SystemRealtimeContext);
  if (!ctx) {
    throw new Error("useSystemRealtime must be used within SystemRealtimeProvider");
  }
  return ctx;
}

export function useSystemRealtimeOptional() {
  return useContext(SystemRealtimeContext);
}

export default function SystemRealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [unreadNotifications, setUnread] = useState(0);
  const [lastZoneEvent, setLastZoneEvent] = useState<ZoneEventPayload | null>(null);
  const [gpsTracking, setGpsTracking] = useState(false);
  const [lastGpsFix, setLastGpsFix] = useState<GpsFix | null>(null);
  const [gpsSuspended, setGpsSuspended] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const stopTrackerRef = useRef<null | (() => void)>(null);
  const identityRef = useRef<TrackingIdentity | null>(null);
  const startGenRef = useRef(0);

  useEffect(() => {
    if (!user?.id) {
      setUnread(0);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("is_read", false);
      if (!cancelled) setUnread(count || 0);
    };
    void load();

    const channel = supabase
      .channel(`sys-notif-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          void load();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setLastZoneEvent(null);
      return;
    }
    const channel = supabase
      .channel(`sys-zone-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "worker_zone_events" },
        (payload) => {
          const row = payload.new as ZoneEventPayload;
          const pid =
            identityRef.current?.project_id ||
            (typeof localStorage !== "undefined" ? localStorage.getItem("selectedProjectId") : null);
          // Require a project match — never fan-out every site's events when GPS is off.
          if (!pid || !row.project_id || row.project_id !== pid) return;
          setLastZoneEvent(row);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const stopGpsTracking = useCallback(() => {
    startGenRef.current += 1;
    stopTrackerRef.current?.();
    stopTrackerRef.current = null;
    identityRef.current = null;
    setGpsTracking(false);
    setGpsSuspended(false);
    setLastGpsFix(null);
    setGpsError(null);
  }, []);

  const startGpsTracking = useCallback(
    (identity: TrackingIdentity) => {
      const prev = identityRef.current;
      const sameSession =
        !!stopTrackerRef.current &&
        !!prev &&
        prev.project_id === identity.project_id &&
        (prev.worker_id || null) === (identity.worker_id || null) &&
        (prev.worker_role || null) === (identity.worker_role || null);
      // company_id can arrive later (roster resolve) — refresh live identity without
      // tearing down the watch when project/worker/role are unchanged.
      if (sameSession) {
        identityRef.current = identity;
        setGpsTracking(true);
        return;
      }
      stopGpsTracking();
      const gen = startGenRef.current;
      identityRef.current = identity;
      setGpsTracking(true);
      setGpsSuspended(false);
      setGpsError(null);

      void import("@/lib/tracking/locationTracker").then(async ({ startTracking, normalizeTrackingConsentStorage }) => {
        normalizeTrackingConsentStorage();
        if (startGenRef.current !== gen) return;

        // All roles (including platform master) auto-stop when raw GPS leaves the site fence.
        let siteCenter: Awaited<ReturnType<typeof resolveSiteTrackingFence>> = null;
        try {
          siteCenter = await resolveSiteTrackingFence(identity.project_id);
        } catch {
          /* tracking still works without site center */
        }

        if (startGenRef.current !== gen) return;

        const stop = await startTracking({
          identity,
          getIdentity: () => identityRef.current || identity,
          siteCenter,
          onLeaveSite: (info) => {
            clearStickyDangerAlert();
            setGpsSuspended(true);
            setLastGpsFix(null);
            toast.message("현장 이탈 · GPS 저전력 대기", {
              id: `gps-leave-${identity.project_id}`,
              description: `현장 기준 약 ${Math.round(info.distanceM)}m (허용 ${Math.round(info.radiusM)}m). 추적을 잠시 멈추고, 현장 안으로 돌아오면 자동 재개합니다.`,
              duration: 6000,
            });
            try {
              window.dispatchEvent(
                new CustomEvent("mobile:gps-auto-stopped", {
                  detail: { projectId: identity.project_id, suspended: true },
                }),
              );
            } catch {
              /* ignore */
            }
          },
          onResumeSite: () => {
            setGpsSuspended(false);
            toast.message("현장 복귀 · GPS 추적 재개", {
              id: `gps-resume-${identity.project_id}`,
              duration: 4000,
            });
          },
          onPreview: (info) => {
            setLastGpsFix({
              lat: info.lat,
              lng: info.lng,
              raw_lat: info.raw_lat,
              raw_lng: info.raw_lng,
              accuracy: info.accuracy,
              at: Date.now(),
              kind: "preview",
            });
            if (info.source === "gps-local" || info.source === "gps" || info.source?.startsWith("gps-bg")) {
              setGpsError((prev) => (prev && /권한|거부|시간 초과|사용할 수 없/.test(prev) ? null : prev));
            }
          },
          onFix: (info) => {
            setLastGpsFix({
              lat: info.lat,
              lng: info.lng,
              raw_lat: info.raw_lat,
              raw_lng: info.raw_lng,
              accuracy: info.accuracy,
              at: Date.now(),
              kind: "fix",
              zone_id: info.zone_id,
              restricted_zone_id: info.restricted_zone_id,
              zone_name: info.zone_name,
              zone_type: info.zone_type,
              event_type: info.event_type,
              ignored: info.ignored,
            });
          },
          onError: (err) => {
            setGpsError(err.message || String(err));
          },
        });
        if (startGenRef.current !== gen) {
          stop();
          return;
        }
        stopTrackerRef.current = stop;
      });
    },
    [stopGpsTracking],
  );

  useEffect(() => () => stopGpsTracking(), [stopGpsTracking]);

  const value = useMemo<SystemRealtimeValue>(
    () => ({
      unreadNotifications,
      lastZoneEvent,
      gpsTracking,
      lastGpsFix,
      gpsSuspended,
      gpsError,
      startGpsTracking,
      stopGpsTracking,
    }),
    [unreadNotifications, lastZoneEvent, gpsTracking, lastGpsFix, gpsSuspended, gpsError, startGpsTracking, stopGpsTracking],
  );

  return (
    <SystemRealtimeContext.Provider value={value}>
      {children}
      <PushNotificationBridge />
    </SystemRealtimeContext.Provider>
  );
}
