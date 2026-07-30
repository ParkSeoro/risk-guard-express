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

type Capacitor = { isNativePlatform?: () => boolean; getPlatform?: () => string };

async function tryNativeBackground(opts: TrackerOptions): Promise<null | (() => void)> {
  const cap = (globalThis as any).Capacitor as Capacitor | undefined;
  if (!cap?.isNativePlatform?.()) return null;
  try {
    const pkg = "@capacitor-community/background-geolocation";
    const mod: any = await import(/* @vite-ignore */ pkg);
    const BackgroundGeolocation = mod.BackgroundGeolocation || mod.default;
    if (!BackgroundGeolocation?.addWatcher) return null;
    const watcherId = await BackgroundGeolocation.addWatcher(
      {
        backgroundMessage: "위험구역 자동감지를 위해 위치를 추적 중입니다.",
        backgroundTitle: "안전관리시스템 위치 추적",
        requestPermissions: true,
        stale: false,
        distanceFilter: 8,
      },
      async (location: any, error: any) => {
        if (error) { opts.onError?.(new Error(error.message || String(error))); return; }
        if (!location) return;
        try {
          const { data } = await supabase.functions.invoke("track-location", {
            body: {
              ...opts.identity,
              lat: location.latitude,
              lng: location.longitude,
              accuracy_m: location.accuracy,
              wifi_scan: [],
              device_ts: new Date(location.time || Date.now()).toISOString(),
            },
          });
          opts.onUpdate?.({
            lat: location.latitude,
            lng: location.longitude,
            accuracy: location.accuracy,
            zone_id: (data as any)?.zone_id ?? null,
            source: (data as any)?.source ?? "gps-bg",
            mode: "bg",
            ...(data as any),
          } as any);
        } catch (e: any) {
          opts.onError?.(new Error(e?.message || String(e)));
        }
      }
    );
    return () => { try { BackgroundGeolocation.removeWatcher({ id: watcherId }); } catch {} };
  } catch (e) {
    if (import.meta.env.DEV) console.warn("background-geo not available, falling back", e);
    return null;
  }
}

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

  // 네이티브 환경: 백그라운드 워처가 가능하면 그쪽으로 위임 (앱 종료/잠금 상태에서도 동작)
  const bgStop = await tryNativeBackground(opts);
  if (bgStop) {
    return () => { stopped = true; bgStop(); };
  }

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
      } else {
        lastPos = here;
      }

      // UI must update on every browser fix — do NOT wait for edge function success.
      // (Previously lastGpsFix stayed null whenever track-location failed → perpetual "측정 중")
      onUpdate?.({
        lat: here.lat,
        lng: here.lng,
        accuracy: pos.coords.accuracy,
        zone_id: null,
        source: "gps-local",
        mode: currentMode,
      });

      // 서버(지오펜스) 송신만 모드별 스로틀
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
          ...(data as any),
        } as any);
      } catch (e: any) {
        // Keep local fix on screen; surface server/geo sync error separately
        onError?.(new Error(e?.message || String(e)));
      }
    },
    (e) => {
      const msg =
        e?.code === 1 ? "위치 권한이 거부되었습니다. 브라우저 설정에서 허용해 주세요."
        : e?.code === 2 ? "위치를 사용할 수 없습니다. GPS를 켜 주세요."
        : e?.code === 3 ? "위치 수신 시간 초과. 야외에서 다시 시도해 주세요."
        : (e?.message || String(e));
      onError?.(new Error(msg));
    }
  );

  return () => {
    stopped = true;
    handle.remove();
  };
}

const CONSENT_KEY = "tracking-consent-v1";

/** Accept legacy "1" written by ConsentPage / DailyHome before SSOT fix. */
export function hasTrackingConsent() {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "yes" || v === "1";
  } catch {
    return false;
  }
}

export function setTrackingConsent(yes: boolean) {
  try {
    localStorage.setItem(CONSENT_KEY, yes ? "yes" : "no");
  } catch {
    /* ignore */
  }
}

/** Normalize legacy "1" → "yes" so all readers agree. */
export function normalizeTrackingConsentStorage() {
  try {
    if (localStorage.getItem(CONSENT_KEY) === "1") {
      localStorage.setItem(CONSENT_KEY, "yes");
    }
  } catch {
    /* ignore */
  }
}
