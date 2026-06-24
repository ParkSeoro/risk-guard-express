// Unified location tracker.
// - Uses @capacitor/geolocation when running inside a native shell.
// - Falls back to navigator.geolocation in the browser / PWA.
// Sends fixes to the `track-location` edge function, which performs the
// authoritative geofence + Wi-Fi zone match server-side.

import { supabase } from "@/integrations/supabase/client";

export type TrackingIdentity = {
  worker_id?: string | null;
  worker_qr_id?: string | null;
  worker_name?: string | null;
  worker_phone?: string | null;
  project_id: string;
};

export type TrackerOptions = {
  identity: TrackingIdentity;
  intervalMs?: number; // foreground sampling interval (default 15s)
  onUpdate?: (info: { lat: number; lng: number; accuracy: number; zone_id: string | null; source: string }) => void;
  onError?: (err: Error) => void;
};

type Capacitor = { isNativePlatform?: () => boolean };

async function getGeolocation(): Promise<{
  watch: (cb: (pos: GeolocationPosition) => void, err: (e: any) => void) => Promise<{ remove: () => void }>;
}> {
  // Detect Capacitor at runtime so the same bundle runs in browser + native.
  const cap = (globalThis as any).Capacitor as Capacitor | undefined;
  if (cap?.isNativePlatform?.()) {
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      await Geolocation.requestPermissions();
      return {
        watch: async (cb, err) => {
          const id = await Geolocation.watchPosition(
            { enableHighAccuracy: true, timeout: 15000 },
            (pos, e) => {
              if (e) return err(e);
              if (pos) cb(pos as unknown as GeolocationPosition);
            }
          );
          return { remove: () => Geolocation.clearWatch({ id }) };
        },
      };
    } catch {
      // fall through to browser
    }
  }
  return {
    watch: async (cb, err) => {
      if (!navigator.geolocation) throw new Error("이 브라우저는 위치 정보를 지원하지 않습니다.");
      const id = navigator.geolocation.watchPosition(cb, err, {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 20000,
      });
      return { remove: () => navigator.geolocation.clearWatch(id) };
    },
  };
}

export async function startTracking(opts: TrackerOptions): Promise<() => void> {
  const { identity, onUpdate, onError } = opts;
  const minIntervalMs = opts.intervalMs ?? 15000;
  let lastSentAt = 0;
  let stopped = false;

  const geo = await getGeolocation();
  const handle = await geo.watch(
    async (pos) => {
      if (stopped) return;
      const now = Date.now();
      if (now - lastSentAt < minIntervalMs) return;
      lastSentAt = now;

      try {
        const { data, error } = await supabase.functions.invoke("track-location", {
          body: {
            ...identity,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy_m: pos.coords.accuracy,
            wifi_scan: [], // browser cannot scan; native build can add a plugin later
            device_ts: new Date(pos.timestamp || Date.now()).toISOString(),
          },
        });
        if (error) throw error;
        onUpdate?.({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          zone_id: (data as any)?.zone_id ?? null,
          source: (data as any)?.source ?? "gps",
        });
      } catch (e: any) {
        onError?.(new Error(e?.message || String(e)));
      }
    },
    (e) => onError?.(new Error(e?.message || String(e)))
  );

  return () => {
    stopped = true;
    handle.remove();
  };
}

const CONSENT_KEY = "tracking-consent-v1";
export function hasTrackingConsent() {
  return localStorage.getItem(CONSENT_KEY) === "yes";
}
export function setTrackingConsent(yes: boolean) {
  localStorage.setItem(CONSENT_KEY, yes ? "yes" : "no");
}
