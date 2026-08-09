/**
 * Geofence danger alarm for the formal /app/worker shell.
 * Uses GPS already started by WorkerGlobalGps (no second tracker).
 * Sticky across screen-off: persist + restore on app resume.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { useSystemRealtime } from "@/providers/SystemRealtimeProvider";
import { supabase } from "@/integrations/supabase/client";
import {
  findViolatingRestrictedZone,
  type BanSubject,
  type RestrictedZoneGeom,
} from "@/lib/tracking/restrictedZoneGeom";
import { resolveBanSubject } from "@/lib/tracking/resolveBanSubject";
import {
  clearStickyDangerAlert,
  loadStickyDangerAlert,
  notifyDangerZoneOs,
  saveStickyDangerAlert,
} from "@/lib/tracking/dangerAlertSticky";
import DangerZoneAlertModal from "@/components/geofence/DangerZoneAlertModal";

/** Require this many consecutive "outside" GPS hits before clearing (jitter). */
const EXIT_STREAK_NEEDED = 3;

function isEntryEventType(t: string): boolean {
  return /unauthorized|restricted|danger|ban/i.test(t) && !/exit|leave|depart/i.test(t);
}

function isExitEventType(t: string): boolean {
  return /^(exit|leave|depart)/i.test(t) || /_exit$/i.test(t);
}

function digitsOnly(phone: string | null | undefined): string {
  return (phone || "").replace(/\D/g, "");
}

/** Local TTS/siren is for the violator only — admins get push, not this modal. */
function isZoneEventAboutMe(
  ev: {
    worker_phone?: string | null;
    worker_qr_id?: string | null;
    worker_name?: string | null;
  },
  opts: {
    phone?: string | null;
    workerId?: string | null;
    displayName?: string | null;
  },
): boolean {
  const evPhone = digitsOnly(ev.worker_phone);
  const myPhone = digitsOnly(opts.phone);
  if (evPhone && myPhone && evPhone === myPhone) return true;
  if (ev.worker_qr_id && opts.workerId && ev.worker_qr_id === opts.workerId) return true;
  const evName = (ev.worker_name || "").trim();
  const myName = (opts.displayName || "").trim();
  if (evName && myName && evName === myName) return true;
  return false;
}

export default function ShellGeofenceAlerts() {
  const { user, profile } = useAuth();
  const { projectId, role, companyId } = useMobileAccess();
  const { lastGpsFix, lastZoneEvent, gpsTracking } = useSystemRealtime();
  const [alertZone, setAlertZone] = useState<{ id: string; name: string } | null>(null);
  const zonesRef = useRef<RestrictedZoneGeom[]>([]);
  const subjectRef = useRef<BanSubject>({});
  const exitStreak = useRef(0);
  /** User tapped dismiss — suppress until they leave that zone. */
  const dismissedZoneId = useRef<string | null>(null);
  const lastOsNotifyAt = useRef(0);
  const lastGpsFixRef = useRef(lastGpsFix);
  lastGpsFixRef.current = lastGpsFix;

  const openAlert = useCallback(
    (zone: { id: string; name: string }, opts?: { osNotify?: boolean }) => {
      if (dismissedZoneId.current && dismissedZoneId.current === zone.id) return;
      setAlertZone(zone);
      if (projectId) {
        saveStickyDangerAlert({
          projectId,
          zoneId: zone.id,
          zoneName: zone.name,
          at: Date.now(),
        });
      }
      if (opts?.osNotify !== false) {
        const now = Date.now();
        if (now - lastOsNotifyAt.current > 20_000) {
          lastOsNotifyAt.current = now;
          void notifyDangerZoneOs(zone.name);
        }
      }
    },
    [projectId],
  );

  const clearAlert = useCallback(() => {
    exitStreak.current = 0;
    setAlertZone(null);
    clearStickyDangerAlert();
  }, []);

  const loadZones = useCallback(async () => {
    if (!projectId) {
      zonesRef.current = [];
      return;
    }
    const { data } = await supabase
      .from("restricted_zones")
      .select(
        "id, name, geometry_type, geo_polygon, center_lat, center_lng, radius_m, banned_worker_ids, banned_company_ids, banned_job_types, access_rules, rule_type, zone_category, zone_color, is_active",
      )
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .eq("is_active", true);
    zonesRef.current = (data || []) as unknown as RestrictedZoneGeom[];
    setAlertZone((prev) => {
      if (!prev) return prev;
      if (prev.id === "zone") return prev;
      const still = zonesRef.current.some((z) => z.id === prev.id);
      return still ? prev : null;
    });
  }, [projectId]);

  // Resolve BanSubject (worker_id / company_id / job_type) — not name/phone/role.
  // Masters get companyId=null from useMobileAccess; resolveBanSubject falls back to membership.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sub = await resolveBanSubject(projectId, {
        phone: profile?.phone,
        companyId,
        userId: user?.id,
      });
      if (!cancelled) subjectRef.current = sub;
    })();
    return () => { cancelled = true; };
  }, [projectId, profile?.phone, companyId, user?.id]);

  useEffect(() => {
    void loadZones();
  }, [loadZones]);

  // Restore sticky alert after remount / OTA — only while GPS tracking is active
  useEffect(() => {
    if (!projectId) return;
    if (!gpsTracking) {
      clearStickyDangerAlert();
      setAlertZone(null);
      return;
    }
    const sticky = loadStickyDangerAlert(projectId);
    if (sticky) {
      setAlertZone({ id: sticky.zoneId, name: sticky.zoneName });
    }
  }, [projectId, gpsTracking]);

  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`shell-rz-${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "restricted_zones", filter: `project_id=eq.${projectId}` },
        () => {
          void loadZones();
        },
      )
      .subscribe();
    const poll = window.setInterval(() => {
      void loadZones();
    }, 60_000);
    return () => {
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [projectId, loadZones]);

  // Re-evaluate when phone unlocks / app returns to foreground
  useEffect(() => {
    if (!projectId) return;
    let remove: (() => void) | undefined;

    const recheck = () => {
      const sticky = loadStickyDangerAlert(projectId);
      const fix = lastGpsFixRef.current;
      if (fix && zonesRef.current.length) {
        const hit = findViolatingRestrictedZone(fix.lat, fix.lng, zonesRef.current, subjectRef.current);
        if (hit) {
          dismissedZoneId.current = null;
          exitStreak.current = 0;
          openAlert({ id: hit.id, name: hit.name }, { osNotify: true });
          return;
        }
      }
      if (sticky) {
        openAlert({ id: sticky.zoneId, name: sticky.zoneName }, { osNotify: true });
      }
    };

    const onVis = () => {
      if (document.visibilityState === "visible") recheck();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);

    if (Capacitor.isNativePlatform()) {
      void import("@capacitor/app").then(({ App }) => {
        const sub = App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) recheck();
        });
        remove = () => {
          void sub.then((h) => h.remove());
        };
      });
    }

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      remove?.();
    };
  }, [projectId, openAlert]);

  useEffect(() => {
    if (!lastGpsFix || !projectId) return;
    const hit = findViolatingRestrictedZone(
      lastGpsFix.lat,
      lastGpsFix.lng,
      zonesRef.current,
      subjectRef.current,
    );
    if (!hit) {
      // Ignore sparse "outside" blips while accuracy is poor (common on wake)
      if ((lastGpsFix.accuracy || 0) > 40) return;
      exitStreak.current += 1;
      if (exitStreak.current >= EXIT_STREAK_NEEDED) {
        dismissedZoneId.current = null;
        clearAlert();
      }
      return;
    }
    exitStreak.current = 0;
    if (dismissedZoneId.current === hit.id) return;
    openAlert({ id: hit.id, name: hit.name });
  }, [lastGpsFix, projectId, openAlert, clearAlert]);

  useEffect(() => {
    if (!lastZoneEvent) return;
    const ev = lastZoneEvent as {
      event_type?: string;
      restricted_zone_id?: string;
      zone_id?: string;
      zone_name?: string;
      worker_phone?: string | null;
      worker_qr_id?: string | null;
      worker_name?: string | null;
    };
    // Realtime fan-out can reach other members — never open violator siren for them.
    if (
      !isZoneEventAboutMe(ev, {
        phone: profile?.phone,
        workerId: subjectRef.current.worker_id,
        displayName: profile?.display_name,
      })
    ) {
      return;
    }

    const t = String(ev.event_type || "");
    const zoneId = ev.restricted_zone_id || ev.zone_id || null;

    if (isExitEventType(t)) {
      // Don't clear sticky UI from a single server exit if GPS still says inside
      if (lastGpsFix && zonesRef.current.length) {
        const hit = findViolatingRestrictedZone(
          lastGpsFix.lat,
          lastGpsFix.lng,
          zonesRef.current,
          subjectRef.current,
        );
        if (hit) return;
      }
      exitStreak.current = EXIT_STREAK_NEEDED;
      dismissedZoneId.current = null;
      clearAlert();
      return;
    }

    if (!isEntryEventType(t)) return;

    dismissedZoneId.current = null;
    openAlert({
      id: zoneId || "zone",
      name: ev.zone_name || "위험 구역",
    });
  }, [lastZoneEvent, lastGpsFix, openAlert, clearAlert, profile?.phone, profile?.display_name]);

  return (
    <DangerZoneAlertModal
      open={!!alertZone}
      zoneName={alertZone?.name}
      workerName={profile?.display_name}
      workerRole={role}
      onDismiss={() => {
        if (alertZone?.id) dismissedZoneId.current = alertZone.id;
        setAlertZone(null);
        clearStickyDangerAlert();
      }}
    />
  );
}
