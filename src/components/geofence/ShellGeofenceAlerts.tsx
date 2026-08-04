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
  type RestrictedZoneGeom,
} from "@/lib/tracking/restrictedZoneGeom";
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

export default function ShellGeofenceAlerts() {
  const { profile } = useAuth();
  const { projectId, role } = useMobileAccess();
  const { lastGpsFix, lastZoneEvent } = useSystemRealtime();
  const [alertZone, setAlertZone] = useState<{ id: string; name: string } | null>(null);
  const zonesRef = useRef<RestrictedZoneGeom[]>([]);
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

  useEffect(() => {
    void loadZones();
  }, [loadZones]);

  // Restore sticky alert after remount / OTA
  useEffect(() => {
    if (!projectId) return;
    const sticky = loadStickyDangerAlert(projectId);
    if (sticky) {
      setAlertZone({ id: sticky.zoneId, name: sticky.zoneName });
    }
  }, [projectId]);

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
      const sub = {
        worker_name: profile?.display_name || null,
        worker_phone: profile?.phone || null,
        worker_role: role || null,
      };
      const fix = lastGpsFixRef.current;
      if (fix && zonesRef.current.length) {
        const hit = findViolatingRestrictedZone(fix.lat, fix.lng, zonesRef.current, sub);
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
  }, [projectId, profile?.display_name, profile?.phone, role, openAlert]);

  useEffect(() => {
    if (!lastGpsFix || !projectId) return;
    const sub = {
      worker_name: profile?.display_name || null,
      worker_phone: profile?.phone || null,
      worker_role: role || null,
    };
    const hit = findViolatingRestrictedZone(
      lastGpsFix.lat,
      lastGpsFix.lng,
      zonesRef.current,
      sub,
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
  }, [lastGpsFix, projectId, profile?.display_name, profile?.phone, role, openAlert, clearAlert]);

  useEffect(() => {
    if (!lastZoneEvent) return;
    const t = String((lastZoneEvent as { event_type?: string }).event_type || "");
    const zoneId =
      (lastZoneEvent as { restricted_zone_id?: string; zone_id?: string }).restricted_zone_id ||
      (lastZoneEvent as { zone_id?: string }).zone_id ||
      null;

    if (isExitEventType(t)) {
      // Don't clear sticky UI from a single server exit if GPS still says inside
      if (lastGpsFix && zonesRef.current.length) {
        const sub = {
          worker_name: profile?.display_name || null,
          worker_phone: profile?.phone || null,
          worker_role: role || null,
        };
        const hit = findViolatingRestrictedZone(
          lastGpsFix.lat,
          lastGpsFix.lng,
          zonesRef.current,
          sub,
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
      name: (lastZoneEvent as { zone_name?: string }).zone_name || "위험 구역",
    });
  }, [lastZoneEvent, lastGpsFix, profile?.display_name, profile?.phone, role, openAlert, clearAlert]);

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
