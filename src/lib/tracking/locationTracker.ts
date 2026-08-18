// Unified location tracker.
// - Uses @capacitor/geolocation when running inside a native shell.
// - Falls back to navigator.geolocation in the browser / PWA.
// Sends fixes to the `track-location` edge function, which performs the
// authoritative geofence + Wi-Fi zone match server-side.
//
// Power policy: eco intervals far from danger zones; high-rate only near/inside.

import { supabase } from "@/integrations/supabase/client";
import { startHeadlessTrack, stopHeadlessTrack } from "@/lib/native/headlessTrack";
import {
  applyGpsCalibration,
  fetchProjectGpsCalibration,
  type GpsCalibration,
} from "@/lib/tracking/gpsCalibration";
import {
  DANGER_PROXIMITY_M,
  isDefinitelyOutsideSite,
  SITE_EXIT_STREAK,
  type SiteTrackingFence,
} from "@/lib/tracking/siteTrackBounds";
import {
  minDistanceToRestrictedZoneEdge,
  type RestrictedZoneGeom,
} from "@/lib/tracking/restrictedZoneGeom";

export type TrackingIdentity = {
  worker_id?: string | null;
  worker_qr_id?: string | null;
  worker_name?: string | null;
  worker_phone?: string | null;
  /** Membership / roster company — used by track-location DENY/ALLOW matching */
  company_id?: string | null;
  worker_role?: string | null;
  project_id: string;
};

async function loadCalibration(projectId: string): Promise<GpsCalibration | null> {
  try {
    return await fetchProjectGpsCalibration(projectId, async (id) => {
      const { data } = await supabase
        .from("projects")
        .select("gps_calibration")
        .eq("id", id)
        .maybeSingle();
      return data?.gps_calibration ?? null;
    });
  } catch {
    return null;
  }
}

async function loadRestrictedZones(projectId: string): Promise<RestrictedZoneGeom[]> {
  try {
    const { data } = await supabase
      .from("restricted_zones")
      .select(
        "id, name, geometry_type, geo_polygon, center_lat, center_lng, radius_m, is_active",
      )
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .eq("is_active", true);
    return (data || []) as unknown as RestrictedZoneGeom[];
  } catch {
    return [];
  }
}

export type TrackerOptions = {
  identity: TrackingIdentity;
  /**
   * Live identity for each track-location invoke.
   * Prefer this over the frozen `identity` snapshot so company_id / role updates
   * take effect without restarting the watch loop.
   */
  getIdentity?: () => TrackingIdentity;
  /**
   * 적응형 주기 (밀리초). 미지정 시 근접도 기반 기본값:
   *  - eco (위험구역에서 멀리): moving 45s / idle 180s
   *  - near (80m 이내): moving 12s / idle 60s
   *  - danger (구역 안): 5s
   */
  intervals?: { moving?: number; idle?: number; danger?: number; ecoMoving?: number; ecoIdle?: number };
  /** 정지로 판단할 누적 정지 시간 (ms). 기본 2분. */
  idleAfterMs?: number;
  /** 이동으로 판단할 최소 이동 거리 (m). 기본 12m. */
  movementThresholdM?: number;
  /** 현장 펜스 — raw GPS 기준 밖이면 onLeaveSite. */
  siteCenter?: SiteTrackingFence | null;
  onLeaveSite?: (info: { distanceM: number; lat: number; lng: number; radiusM: number }) => void;
  onUpdate?: (info: {
    /** Map-aligned (calibrated) coordinates for local UI / zone preview. */
    lat: number;
    lng: number;
    /** Device raw GPS — send these to track-location (server calibrates once). */
    raw_lat: number;
    raw_lng: number;
    accuracy: number;
    zone_id: string | null;
    source: string;
    mode: string;
  }) => void;
  onError?: (err: Error) => void;
};

type Capacitor = { isNativePlatform?: () => boolean; getPlatform?: () => string };
type PowerMode = "eco" | "near" | "danger" | "idle";

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

function pickIntervalMs(
  mode: PowerMode,
  intervals: {
    moving: number;
    idle: number;
    danger: number;
    ecoMoving: number;
    ecoIdle: number;
  },
): number {
  if (mode === "danger") return intervals.danger;
  if (mode === "near") return intervals.moving;
  if (mode === "idle") return intervals.ecoIdle;
  return intervals.ecoMoving;
}

function resolvePowerMode(args: {
  distToZoneM: number;
  inDangerFromServer: boolean;
  idle: boolean;
}): PowerMode {
  if (args.inDangerFromServer || args.distToZoneM <= 0) return "danger";
  if (args.distToZoneM <= DANGER_PROXIMITY_M) return "near";
  if (args.idle) return "idle";
  return "eco";
}

async function tryNativeBackground(opts: TrackerOptions): Promise<null | (() => void)> {
  const cap = (globalThis as any).Capacitor as Capacitor | undefined;
  if (!cap?.isNativePlatform?.()) return null;
  try {
    const { registerPlugin } = await import("@capacitor/core");
    const BackgroundGeolocation = registerPlugin<any>("BackgroundGeolocation");
    if (!BackgroundGeolocation?.addWatcher) return null;

    let cal = await loadCalibration(opts.identity.project_id);
    let zones = await loadRestrictedZones(opts.identity.project_id);
    let zonesAt = Date.now();

    const intervals = {
      moving: opts.intervals?.moving ?? 12_000,
      idle: opts.intervals?.idle ?? 60_000,
      danger: opts.intervals?.danger ?? 5_000,
      ecoMoving: opts.intervals?.ecoMoving ?? 45_000,
      ecoIdle: opts.intervals?.ecoIdle ?? 180_000,
    };
    let lastSentAt = 0;
    let lastPos: { lat: number; lng: number } | null = null;
    let lastMovedAt = Date.now();
    let currentMode: PowerMode = "eco";
    let outsideStreak = 0;
    let leftSite = false;
    let inDangerFromServer = false;
    const idleAfterMs = opts.idleAfterMs ?? 2 * 60_000;
    const movementThresholdM = opts.movementThresholdM ?? 12;
    const site = opts.siteCenter;

    const watcherId = await BackgroundGeolocation.addWatcher(
      {
        backgroundMessage: "현장 안전 위치 추적 중 (위험구역 근처에서만 고정밀)",
        backgroundTitle: "SafeNex 위치 추적",
        requestPermissions: false,
        stale: false,
        // Wider filter = fewer wakeups far from zones (near-zone still uses time throttle)
        distanceFilter: 15,
      },
      async (location: any, error: any) => {
        if (leftSite) return;
        if (error) {
          opts.onError?.(new Error(error.message || String(error)));
          return;
        }
        if (!location) return;
        try {
          const now = Date.now();
          if (now - zonesAt > 120_000) {
            zones = await loadRestrictedZones(opts.identity.project_id);
            zonesAt = now;
          }
          cal = await loadCalibration(opts.identity.project_id);
          const rawLat = location.latitude;
          const rawLng = location.longitude;
          const accuracy = Number(location.accuracy) || 30;
          const disp = applyGpsCalibration(rawLat, rawLng, cal);

          // Site leave: RAW GPS vs fence (do not mix map calibration)
          if (site && Number.isFinite(site.lat) && Number.isFinite(site.lng)) {
            const { outside, distanceM: d } = isDefinitelyOutsideSite(
              site,
              rawLat,
              rawLng,
              accuracy,
            );
            if (outside) {
              outsideStreak += 1;
              if (outsideStreak >= SITE_EXIT_STREAK) {
                leftSite = true;
                opts.onLeaveSite?.({
                  distanceM: d,
                  lat: rawLat,
                  lng: rawLng,
                  radiusM: site.radiusM,
                });
                try {
                  await BackgroundGeolocation.removeWatcher({ id: watcherId });
                } catch {
                  /* ignore */
                }
                return;
              }
            } else {
              outsideStreak = 0;
            }
          }

          const distToZone = minDistanceToRestrictedZoneEdge(disp.lat, disp.lng, zones);
          let idle = false;
          if (lastPos) {
            const moved = distanceM(lastPos, { lat: disp.lat, lng: disp.lng });
            if (moved >= movementThresholdM) {
              lastMovedAt = now;
            } else if (now - lastMovedAt >= idleAfterMs) {
              idle = true;
            }
          }
          lastPos = { lat: disp.lat, lng: disp.lng };
          currentMode = resolvePowerMode({
            distToZoneM: distToZone,
            inDangerFromServer,
            idle,
          });

          opts.onUpdate?.({
            lat: disp.lat,
            lng: disp.lng,
            raw_lat: rawLat,
            raw_lng: rawLng,
            accuracy,
            zone_id: null,
            source: "gps-bg-local",
            mode: currentMode,
          });

          const minInterval = pickIntervalMs(currentMode, intervals);
          if (now - lastSentAt < minInterval) return;
          lastSentAt = now;

          const liveId = opts.getIdentity?.() ?? opts.identity;
          const { data } = await supabase.functions.invoke("track-location", {
            body: {
              ...liveId,
              lat: rawLat,
              lng: rawLng,
              accuracy_m: accuracy,
              wifi_scan: [],
              device_ts: new Date(location.time || Date.now()).toISOString(),
            },
          });
          const zoneType = (data as any)?.zone_type as string | undefined;
          inDangerFromServer =
            zoneType === "danger" ||
            zoneType === "restricted" ||
            (data as any)?.event_type === "unauthorized_entry";
          currentMode = resolvePowerMode({
            distToZoneM: distToZone,
            inDangerFromServer,
            idle,
          });
          opts.onUpdate?.({
            lat: disp.lat,
            lng: disp.lng,
            raw_lat: rawLat,
            raw_lng: rawLng,
            accuracy,
            zone_id: (data as any)?.zone_id ?? null,
            source: (data as any)?.source ?? "gps-bg",
            mode: currentMode,
            ...(data as any),
          } as any);
        } catch (e: any) {
          opts.onError?.(new Error(e?.message || String(e)));
        }
      },
    );
    return () => {
      try {
        BackgroundGeolocation.removeWatcher({ id: watcherId });
      } catch {
        /* ignore */
      }
    };
  } catch (e) {
    if (import.meta.env.DEV) console.warn("background-geo not available, falling back", e);
    return null;
  }
}

async function getGeolocation(): Promise<{
  watch: (
    cb: (pos: GeolocationPosition) => void,
    err: (e: any) => void,
  ) => Promise<{ remove: () => void }>;
}> {
  const cap = (globalThis as any).Capacitor as Capacitor | undefined;
  if (cap?.isNativePlatform?.()) {
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      const status = await Geolocation.checkPermissions();
      const granted =
        status.location === "granted" || status.coarseLocation === "granted";
      if (!granted) {
        const { hasCompletedNativePermissions } = await import("@/lib/native/isNativeApp");
        if (hasCompletedNativePermissions()) {
          throw new Error("위치 권한이 없습니다. 설정에서 위치를 허용해 주세요.");
        }
        await Geolocation.requestPermissions();
      }
      return {
        watch: async (cb, err) => {
          const id = await Geolocation.watchPosition(
            { enableHighAccuracy: true, timeout: 15000 },
            (pos, e) => {
              if (e) return err(e);
              if (pos) cb(pos as unknown as GeolocationPosition);
            },
          );
          return { remove: () => Geolocation.clearWatch({ id }) };
        },
      };
    } catch (e) {
      if (e instanceof Error && /위치 권한/.test(e.message)) throw e;
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

async function startHeadlessCompanion(opts: TrackerOptions): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const session = data?.session;
    if (!session?.access_token) return;
    const live = opts.getIdentity?.() ?? opts.identity;
    const site = opts.siteCenter;
    await startHeadlessTrack({
      projectId: live.project_id,
      workerId: live.worker_id,
      workerName: live.worker_name,
      workerPhone: live.worker_phone,
      companyId: live.company_id,
      workerRole: live.worker_role,
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      fenceLat: site?.lat ?? null,
      fenceLng: site?.lng ?? null,
      fenceRadiusM: site?.radiusM ?? null,
      intervalMs: 45_000,
    });
  } catch (e) {
    if (import.meta.env.DEV) console.warn("[HeadlessTrack] companion start skipped", e);
  }
}

export async function startTracking(opts: TrackerOptions): Promise<() => void> {
  const { identity, onUpdate, onError } = opts;
  const intervals = {
    moving: opts.intervals?.moving ?? 12_000,
    idle: opts.intervals?.idle ?? 60_000,
    danger: opts.intervals?.danger ?? 5_000,
    ecoMoving: opts.intervals?.ecoMoving ?? 45_000,
    ecoIdle: opts.intervals?.ecoIdle ?? 180_000,
  };
  const idleAfterMs = opts.idleAfterMs ?? 2 * 60_000;
  const movementThresholdM = opts.movementThresholdM ?? 12;
  const site = opts.siteCenter;

  let lastSentAt = 0;
  let lastPos: { lat: number; lng: number; ts: number } | null = null;
  let lastMovedAt = Date.now();
  let currentMode: PowerMode = "eco";
  let stopped = false;
  let outsideStreak = 0;
  let inDangerFromServer = false;
  let cal = await loadCalibration(identity.project_id);
  let zones = await loadRestrictedZones(identity.project_id);
  let zonesAt = Date.now();

  const bgStop = await tryNativeBackground(opts);
  if (bgStop) {
    void startHeadlessCompanion(opts);
    const stop = () => {
      stopped = true;
      bgStop();
      void stopHeadlessTrack();
    };
    (stop as any).__usedBackground = true;
    return stop;
  }

  const geo = await getGeolocation();
  let watchHandle: { remove: () => void } | null = null;
  const handle = await geo.watch(
    async (pos) => {
      if (stopped) return;
      const now = Date.now();
      if (now - zonesAt > 120_000) {
        zones = await loadRestrictedZones(identity.project_id);
        zonesAt = now;
      }
      const raw = { lat: pos.coords.latitude, lng: pos.coords.longitude, ts: now };
      const accuracy = pos.coords.accuracy ?? 30;
      cal = await loadCalibration(identity.project_id);
      const disp = applyGpsCalibration(raw.lat, raw.lng, cal);
      const here = { lat: disp.lat, lng: disp.lng, ts: now };

      if (site && Number.isFinite(site.lat) && Number.isFinite(site.lng)) {
        const { outside, distanceM: d } = isDefinitelyOutsideSite(
          site,
          raw.lat,
          raw.lng,
          accuracy,
        );
        if (outside) {
          outsideStreak += 1;
          if (outsideStreak >= SITE_EXIT_STREAK) {
            stopped = true;
            try {
              watchHandle?.remove();
            } catch {
              /* ignore */
            }
            opts.onLeaveSite?.({
              distanceM: d,
              lat: raw.lat,
              lng: raw.lng,
              radiusM: site.radiusM,
            });
            return;
          }
        } else {
          outsideStreak = 0;
        }
      }

      let idle = false;
      if (lastPos) {
        const d = distanceM(lastPos, here);
        if (d >= movementThresholdM) {
          lastMovedAt = now;
        } else if (now - lastMovedAt >= idleAfterMs) {
          idle = true;
        }
      } else {
        lastPos = here;
      }

      const distToZone = minDistanceToRestrictedZoneEdge(here.lat, here.lng, zones);
      currentMode = resolvePowerMode({
        distToZoneM: distToZone,
        inDangerFromServer,
        idle,
      });

      onUpdate?.({
        lat: here.lat,
        lng: here.lng,
        raw_lat: raw.lat,
        raw_lng: raw.lng,
        accuracy,
        zone_id: null,
        source: "gps-local",
        mode: currentMode,
      });

      const minInterval = pickIntervalMs(currentMode, intervals);
      if (now - lastSentAt < minInterval) return;
      lastSentAt = now;
      lastPos = here;

      try {
        const liveId = opts.getIdentity?.() ?? identity;
        const { data, error } = await supabase.functions.invoke("track-location", {
          body: {
            ...liveId,
            lat: raw.lat,
            lng: raw.lng,
            accuracy_m: accuracy,
            wifi_scan: [],
            device_ts: new Date(pos.timestamp || now).toISOString(),
          },
        });
        if (error) throw error;

        const zoneType = (data as any)?.zone_type as string | undefined;
        inDangerFromServer =
          zoneType === "danger" ||
          zoneType === "restricted" ||
          (data as any)?.event_type === "unauthorized_entry";
        currentMode = resolvePowerMode({
          distToZoneM: distToZone,
          inDangerFromServer,
          idle,
        });

        onUpdate?.({
          lat: here.lat,
          lng: here.lng,
          raw_lat: raw.lat,
          raw_lng: raw.lng,
          accuracy,
          zone_id: (data as any)?.zone_id ?? null,
          source: (data as any)?.source ?? "gps",
          mode: currentMode,
          ...(data as any),
        } as any);
      } catch (e: any) {
        onError?.(new Error(e?.message || String(e)));
      }
    },
    (e) => {
      const msg =
        e?.code === 1
          ? "위치 권한이 거부되었습니다. 브라우저 설정에서 허용해 주세요."
          : e?.code === 2
            ? "위치를 사용할 수 없습니다. GPS를 켜 주세요."
            : e?.code === 3
              ? "위치 수신 시간 초과. 야외에서 다시 시도해 주세요."
              : e?.message || String(e);
      onError?.(new Error(msg));
    },
  );
  watchHandle = handle;
  void startHeadlessCompanion(opts);

  return () => {
    stopped = true;
    handle.remove();
    void stopHeadlessTrack();
  };
}

const CONSENT_KEY = "tracking-consent-v1";

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

export function normalizeTrackingConsentStorage() {
  try {
    if (localStorage.getItem(CONSENT_KEY) === "1") {
      localStorage.setItem(CONSENT_KEY, "yes");
    }
  } catch {
    /* ignore */
  }
}
