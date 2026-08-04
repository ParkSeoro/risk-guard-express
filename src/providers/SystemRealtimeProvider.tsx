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

export type GpsFix = {
  lat: number;
  lng: number;
  accuracy: number;
  at: number;
};

type ZoneEventPayload = {
  id?: string;
  project_id?: string;
  zone_id?: string;
  event_type?: string;
  worker_name?: string;
  created_at?: string;
};

type SystemRealtimeValue = {
  unreadNotifications: number;
  lastZoneEvent: ZoneEventPayload | null;
  gpsTracking: boolean;
  lastGpsFix: GpsFix | null;
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
  const [gpsError, setGpsError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
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
          setLastZoneEvent(payload.new as ZoneEventPayload);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const postFix = useCallback(async (lat: number, lng: number, accuracy: number, source: string) => {
    const identity = identityRef.current;
    if (!identity) return;
    // Display calibrated; send RAW so track-location does not double-apply.
    let dispLat = lat;
    let dispLng = lng;
    try {
      const { fetchProjectGpsCalibration, applyGpsCalibration } = await import(
        "@/lib/tracking/gpsCalibration"
      );
      const cal = await fetchProjectGpsCalibration(identity.project_id, async (id) => {
        const { data } = await supabase
          .from("projects")
          .select("gps_calibration")
          .eq("id", id)
          .maybeSingle();
        return data?.gps_calibration ?? null;
      });
      const disp = applyGpsCalibration(lat, lng, cal);
      dispLat = disp.lat;
      dispLng = disp.lng;
    } catch {
      /* keep raw for UI if calibration fetch fails */
    }
    setLastGpsFix({ lat: dispLat, lng: dispLng, accuracy, at: Date.now() });
    try {
      await supabase.functions.invoke("track-location", {
        // Edge expects accuracy_m (Zod); keep source for diagnostics
        body: { ...identity, lat, lng, accuracy_m: accuracy, source },
      });
    } catch (e) {
      console.warn("[SystemRealtime] track-location failed", e);
    }
  }, []);

  const stopGpsTracking = useCallback(() => {
    startGenRef.current += 1;
    stopTrackerRef.current?.();
    stopTrackerRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    identityRef.current = null;
    setGpsTracking(false);
    setGpsError(null);
  }, []);

  const startGpsTracking = useCallback(
    (identity: TrackingIdentity) => {
      const prev = identityRef.current;
      if (
        stopTrackerRef.current &&
        prev &&
        prev.project_id === identity.project_id &&
        (prev.worker_id || null) === (identity.worker_id || null)
      ) {
        // Idempotent — avoid stop/start storms (permission dialog loops)
        identityRef.current = identity;
        setGpsTracking(true);
        return;
      }
      stopGpsTracking();
      const gen = startGenRef.current;
      identityRef.current = identity;
      setGpsTracking(true);
      setGpsError(null);

      // Prefer unified tracker (native BG → Capacitor → browser). Worker ticks as secondary.
      void import("@/lib/tracking/locationTracker").then(async ({ startTracking, normalizeTrackingConsentStorage }) => {
        normalizeTrackingConsentStorage();
        if (startGenRef.current !== gen) return;
        const stop = await startTracking({
          identity,
          onUpdate: (info) => {
            setLastGpsFix({
              lat: info.lat,
              lng: info.lng,
              accuracy: info.accuracy,
              at: Date.now(),
            });
            // Clear permission-style errors once we have a fix; keep soft server errors quiet
            if (info.source === "gps-local" || info.source === "gps") {
              setGpsError((prev) => (prev && /권한|거부|시간 초과|사용할 수 없/.test(prev) ? null : prev));
            }
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

      try {
        const worker = new Worker(new URL("../workers/gpsTracker.worker.ts", import.meta.url), {
          type: "module",
        });
        workerRef.current = worker;
        worker.postMessage({ type: "start", intervalMs: 15000 });
        worker.onmessage = (ev) => {
          if (ev.data?.type !== "tick") return;
          if (!("geolocation" in navigator)) return;
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              // postFix applies project GPS bias for display, then posts RAW to track-location.
              void postFix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, "web-worker-tick");
            },
            (err) => {
              const msg =
                err?.code === 1 ? "위치 권한이 거부되었습니다. 설정에서 위치를 허용해 주세요."
                : err?.code === 2 ? "위치를 사용할 수 없습니다. GPS를 켜 주세요."
                : err?.code === 3 ? "위치 수신 시간 초과. 야외에서 다시 시도해 주세요."
                : (err.message || "GPS 오류");
              setGpsError(msg);
              console.warn("[SystemRealtime] geo error", err.message);
            },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 },
          );
        };
      } catch (e) {
        console.warn("[SystemRealtime] GPS worker unavailable", e);
      }
    },
    [postFix, stopGpsTracking],
  );

  useEffect(() => () => stopGpsTracking(), [stopGpsTracking]);

  const value = useMemo<SystemRealtimeValue>(
    () => ({
      unreadNotifications,
      lastZoneEvent,
      gpsTracking,
      lastGpsFix,
      gpsError,
      startGpsTracking,
      stopGpsTracking,
    }),
    [unreadNotifications, lastZoneEvent, gpsTracking, lastGpsFix, gpsError, startGpsTracking, stopGpsTracking],
  );

  return (
    <SystemRealtimeContext.Provider value={value}>
      {children}
      <PushNotificationBridge />
    </SystemRealtimeContext.Provider>
  );
}
