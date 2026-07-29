/**
 * Global realtime + push context.
 * Mount once under AuthProvider. GeofenceAlertBridge stays on worker shells
 * (needs projectId); this provider owns notifications realtime + GPS worker API.
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
  const workerRef = useRef<Worker | null>(null);
  const stopTrackerRef = useRef<null | (() => void)>(null);
  const identityRef = useRef<TrackingIdentity | null>(null);

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
    if (!user?.id) return;
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
    try {
      await supabase.functions.invoke("track-location", {
        body: { ...identity, lat, lng, accuracy, source },
      });
    } catch (e) {
      console.warn("[SystemRealtime] track-location failed", e);
    }
  }, []);

  const stopGpsTracking = useCallback(() => {
    stopTrackerRef.current?.();
    stopTrackerRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    identityRef.current = null;
    setGpsTracking(false);
  }, []);

  const startGpsTracking = useCallback(
    (identity: TrackingIdentity) => {
      stopGpsTracking();
      identityRef.current = identity;
      setGpsTracking(true);

      // Worker emits ticks; main thread owns geolocation (workers lack geo in most browsers).
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
              void postFix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, "web-worker-tick");
            },
            (err) => console.warn("[SystemRealtime] geo error", err.message),
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 },
          );
        };
      } catch (e) {
        console.warn("[SystemRealtime] Worker unavailable, using locationTracker", e);
        void import("@/lib/tracking/locationTracker").then(async ({ startTracking }) => {
          stopTrackerRef.current = await startTracking({ identity });
        });
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
      startGpsTracking,
      stopGpsTracking,
    }),
    [unreadNotifications, lastZoneEvent, gpsTracking, startGpsTracking, stopGpsTracking],
  );

  return (
    <SystemRealtimeContext.Provider value={value}>
      {children}
      <PushNotificationBridge />
    </SystemRealtimeContext.Provider>
  );
}
