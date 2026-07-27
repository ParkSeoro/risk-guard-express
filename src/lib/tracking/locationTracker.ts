/**
 * Unified location tracker for geofence / danger-zone alarms.
 *
 * Native (Capacitor):
 *   Uses @capacitor-community/background-geolocation so GPS keeps flowing
 *   while the screen is off / app is backgrounded. Each fix is posted to the
 *   `track-location` Edge Function (Supabase), which performs authoritative
 *   geofence + Wi-Fi zone matching server-side.
 *
 * Web / PWA:
 *   Falls back to @capacitor/geolocation or navigator.geolocation with
 *   adaptive send intervals (moving / idle / danger).
 *
 * Prerequisites (capacitor.config.ts):
 *   - webDir: 'dist'
 *   - android.useLegacyBridge: true   (keeps BG watcher alive past ~5 min)
 *   - CapacitorHttp.enabled: true     (BG network not throttled by WebView)
 */

import { registerPlugin } from "@capacitor/core";
import type {
  BackgroundGeolocationPlugin,
  CallbackError,
  Location as BgLocation,
} from "@capacitor-community/background-geolocation";
import { supabase } from "@/integrations/supabase/client";
import { isNativeApp } from "@/lib/native/platform";

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
  onUpdate?: (info: {
    lat: number;
    lng: number;
    accuracy: number;
    zone_id: string | null;
    source: string;
    mode: string;
  }) => void;
  onError?: (err: Error) => void;
};

type AdaptiveState = {
  lastSentAt: number;
  lastPos: { lat: number; lng: number; ts: number } | null;
  lastMovedAt: number;
  currentMode: "moving" | "idle" | "danger";
  intervals: { moving: number; idle: number; danger: number };
  idleAfterMs: number;
  movementThresholdM: number;
};

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>(
  "BackgroundGeolocation"
);

/** Haversine distance in metres */
function distanceM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function createAdaptiveState(opts: TrackerOptions): AdaptiveState {
  return {
    lastSentAt: 0,
    lastPos: null,
    lastMovedAt: Date.now(),
    currentMode: "moving",
    intervals: {
      moving: opts.intervals?.moving ?? 10_000,
      idle: opts.intervals?.idle ?? 60_000,
      danger: opts.intervals?.danger ?? 5_000,
    },
    idleAfterMs: opts.idleAfterMs ?? 5 * 60_000,
    movementThresholdM: opts.movementThresholdM ?? 8,
  };
}

/** Update mode from movement; return false if we should skip this send (throttled). */
function shouldSendFix(
  state: AdaptiveState,
  lat: number,
  lng: number,
  now: number
): boolean {
  const here = { lat, lng, ts: now };
  if (state.lastPos) {
    const d = distanceM(state.lastPos, here);
    if (d >= state.movementThresholdM) {
      state.lastMovedAt = now;
      if (state.currentMode === "idle") state.currentMode = "moving";
    } else if (now - state.lastMovedAt >= state.idleAfterMs) {
      if (state.currentMode !== "danger") state.currentMode = "idle";
    }
  }

  const minInterval = state.intervals[state.currentMode];
  if (now - state.lastSentAt < minInterval) return false;
  state.lastSentAt = now;
  state.lastPos = here;
  return true;
}

function applyServerZoneMode(state: AdaptiveState, data: unknown, now: number) {
  const zoneType = (data as { zone_type?: string } | null)?.zone_type;
  const eventType = (data as { event_type?: string } | null)?.event_type;
  if (
    zoneType === "danger" ||
    zoneType === "restricted" ||
    eventType === "unauthorized_entry"
  ) {
    state.currentMode = "danger";
  } else if (state.currentMode === "danger") {
    state.currentMode =
      now - state.lastMovedAt >= state.idleAfterMs ? "idle" : "moving";
  }
}

async function postFix(
  identity: TrackingIdentity,
  lat: number,
  lng: number,
  accuracy: number,
  deviceTs: string
) {
  const { data, error } = await supabase.functions.invoke("track-location", {
    body: {
      ...identity,
      lat,
      lng,
      accuracy_m: accuracy,
      wifi_scan: [],
      device_ts: deviceTs,
    },
  });
  if (error) throw error;
  return data;
}

/** Android 13+: FG 알림 표시를 위해 알림 권한 선요청 (가능하면). */
async function ensureNotificationPermission() {
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const status = await PushNotifications.checkPermissions();
    if (status.receive !== "granted") {
      await PushNotifications.requestPermissions();
    }
  } catch {
    // push plugin 없거나 웹 — 무시
  }
}

/**
 * Native background geolocation watcher.
 * Returns a stop() fn, or null if the plugin / platform is unavailable.
 */
async function tryNativeBackground(
  opts: TrackerOptions,
  state: AdaptiveState,
  isStopped: () => boolean
): Promise<null | (() => void)> {
  if (!isNativeApp()) return null;

  try {
    await ensureNotificationPermission();

    // Capacitor Geolocation 권한도 선요청 (Always / WhenInUse 흐름)
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      await Geolocation.requestPermissions();
    } catch {
      // BackgroundGeolocation.requestPermissions 가 대신 처리
    }

    const watcherId = await BackgroundGeolocation.addWatcher(
      {
        // backgroundMessage 가 정의돼야 때만 Android FG 서비스 + 백그라운드 위치 보장
        backgroundMessage:
          "위험구역 자동감지를 위해 위치를 추적 중입니다. 작업이 끝나면 추적을 중지해 주세요.",
        backgroundTitle: "Safenex 위치 추적",
        requestPermissions: true,
        stale: false,
        distanceFilter: opts.movementThresholdM ?? 8,
      },
      async (location?: BgLocation, error?: CallbackError) => {
        if (isStopped()) return;

        if (error) {
          if (error.code === "NOT_AUTHORIZED") {
            opts.onError?.(
              new Error(
                "위치 권한이 필요합니다. 설정에서 '항상 허용'으로 변경해 주세요."
              )
            );
            try {
              await BackgroundGeolocation.openSettings();
            } catch {
              /* ignore */
            }
          } else {
            opts.onError?.(new Error(error.message || String(error)));
          }
          return;
        }

        if (!location) return;

        // stale=false 이지만 방어적으로 오래된 fix 스킵 (2분 초과)
        const fixTs = location.time ?? Date.now();
        if (Date.now() - fixTs > 120_000) return;

        const now = Date.now();
        if (!shouldSendFix(state, location.latitude, location.longitude, now)) {
          return;
        }

        try {
          const data = await postFix(
            opts.identity,
            location.latitude,
            location.longitude,
            location.accuracy ?? 0,
            new Date(fixTs).toISOString()
          );
          applyServerZoneMode(state, data, now);
          opts.onUpdate?.({
            lat: location.latitude,
            lng: location.longitude,
            accuracy: location.accuracy ?? 0,
            zone_id: (data as { zone_id?: string | null } | null)?.zone_id ?? null,
            source: (data as { source?: string } | null)?.source ?? "gps-bg",
            mode: state.currentMode,
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          opts.onError?.(new Error(msg));
        }
      }
    );

    return () => {
      try {
        void BackgroundGeolocation.removeWatcher({ id: watcherId });
      } catch {
        /* ignore */
      }
    };
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn("[locationTracker] background-geo unavailable, falling back", e);
    }
    return null;
  }
}

async function getForegroundWatcher(): Promise<{
  watch: (
    cb: (pos: GeolocationPosition) => void,
    err: (e: { message?: string }) => void
  ) => Promise<{ remove: () => void }>;
}> {
  if (isNativeApp()) {
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      await Geolocation.requestPermissions();
      return {
        watch: async (cb, err) => {
          const id = await Geolocation.watchPosition(
            { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5_000 },
            (pos, e) => {
              if (e) return err(e);
              if (pos) cb(pos as unknown as GeolocationPosition);
            }
          );
          return { remove: () => void Geolocation.clearWatch({ id }) };
        },
      };
    } catch {
      // fall through to browser API
    }
  }

  return {
    watch: async (cb, err) => {
      if (!navigator.geolocation) {
        throw new Error("이 브라우저는 위치 정보를 지원하지 않습니다.");
      }
      const id = navigator.geolocation.watchPosition(cb, err, {
        enableHighAccuracy: true,
        maximumAge: 5_000,
        timeout: 20_000,
      });
      return { remove: () => navigator.geolocation.clearWatch(id) };
    },
  };
}

/**
 * Start continuous tracking. Resolves to a stop() function.
 * On native, prefers Background Geolocation so fixes continue with the screen off.
 */
export async function startTracking(opts: TrackerOptions): Promise<() => void> {
  const { identity, onUpdate, onError } = opts;
  const state = createAdaptiveState(opts);
  let stopped = false;
  const isStopped = () => stopped;

  // 1) Native background path (screen-off / app backgrounded)
  const bgStop = await tryNativeBackground(opts, state, isStopped);
  if (bgStop) {
    return () => {
      stopped = true;
      bgStop();
    };
  }

  // 2) Foreground / web fallback with adaptive intervals
  const geo = await getForegroundWatcher();
  const handle = await geo.watch(
    async (pos) => {
      if (stopped) return;
      const now = Date.now();
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      if (!shouldSendFix(state, lat, lng, now)) return;

      try {
        const data = await postFix(
          identity,
          lat,
          lng,
          pos.coords.accuracy,
          new Date(pos.timestamp || now).toISOString()
        );
        applyServerZoneMode(state, data, now);
        onUpdate?.({
          lat,
          lng,
          accuracy: pos.coords.accuracy,
          zone_id: (data as { zone_id?: string | null } | null)?.zone_id ?? null,
          source: (data as { source?: string } | null)?.source ?? "gps",
          mode: state.currentMode,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        onError?.(new Error(msg));
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
