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
  /**
   * 적응형 주기 (밀리초). 미지정 시 기본값:
   *  - moving:  10초  (이동 감지 시)
   *  - idle:    60초  (5분 이상 정지)
   *  - danger:   5초  (위험/제한 구역 진입 시 자동 상향)
   */
  intervals?: { moving?: number; idle?: number; danger?: number };
  /** 정지로 판단할 누적 정지 시간 (ms). 기본 5분. */
  idleAfterMs?: number;
  /** 이동으로 판단할 최소 이동 거리 (m). 기본 8m. */
  movementThresholdM?: number;
  onUpdate?: (info: { lat: number; lng: number; accuracy: number; zone_id: string | null; source: string; mode: string }) => void;
  onError?: (err: Error) => void;
};

type Capacitor = { isNativePlatform?: () => boolean };

async function getGeolocation(): Promise<{
  watch: (cb: (pos: GeolocationPosition) => void, err: (e: any) => void) => Promise<{ remove: () => void }>;
}> {
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
      // fall through
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

// 두 좌표 사이 거리 (m) - Haversine
function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export async function startTracking(opts: TrackerOptions): Promise<() => void> {
  const { identity, onUpdate, onError } = opts;
  const intervals = {
    moving: opts.intervals?.moving ?? 10_000,
    idle: opts.intervals?.idle ?? 60_000,
    danger: opts.intervals?.danger ?? 5_000,
  };
  const idleAfterMs = opts.idleAfterMs ?? 5 * 60_000;
  const movementThresholdM = opts.movementThresholdM ?? 8;

  let lastSentAt = 0;
  let lastPos: { lat: number; lng: number; ts: number } | null = null;
  let lastMovedAt = Date.now();
  let currentMode: "moving" | "idle" | "danger" = "moving";
  let stopped = false;

  const geo = await getGeolocation();
  const handle = await geo.watch(
    async (pos) => {
      if (stopped) return;
      const now = Date.now();
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude, ts: now };

      // 이동/정지 판단
      if (lastPos) {
        const d = distanceM(lastPos, here);
        if (d >= movementThresholdM) {
          lastMovedAt = now;
          if (currentMode === "idle") currentMode = "moving";
        } else if (now - lastMovedAt >= idleAfterMs) {
          if (currentMode !== "danger") currentMode = "idle";
        }
      }

      // 현재 모드에 따른 최소 송신 간격
      const minInterval = intervals[currentMode];
      if (now - lastSentAt < minInterval) return;
      lastSentAt = now;
      lastPos = here;

      try {
        const { data, error } = await supabase.functions.invoke("track-location", {
          body: {
            ...identity,
            lat: here.lat,
            lng: here.lng,
            accuracy_m: pos.coords.accuracy,
            wifi_scan: [],
            device_ts: new Date(pos.timestamp || now).toISOString(),
          },
        });
        if (error) throw error;

        // 서버 응답에 따라 위험구역이면 danger 모드(5초)로 상향, 아니면 복귀
        const zoneType = (data as any)?.zone_type as string | undefined;
        if (zoneType === "danger" || zoneType === "restricted" || (data as any)?.event_type === "unauthorized_entry") {
          currentMode = "danger";
        } else if (currentMode === "danger") {
          currentMode = now - lastMovedAt >= idleAfterMs ? "idle" : "moving";
        }

        onUpdate?.({
          lat: here.lat,
          lng: here.lng,
          accuracy: pos.coords.accuracy,
          zone_id: (data as any)?.zone_id ?? null,
          source: (data as any)?.source ?? "gps",
          mode: currentMode,
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
