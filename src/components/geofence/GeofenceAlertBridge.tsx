import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import {
  startTracking,
  hasTrackingConsent,
  type TrackingIdentity,
} from "@/lib/tracking/locationTracker";
import {
  findViolatingRestrictedZone,
  type RestrictedZoneGeom,
} from "@/lib/tracking/restrictedZoneGeom";
import DangerZoneAlertModal from "./DangerZoneAlertModal";

type Subject = {
  worker_id?: string | null;
  company_id?: string | null;
  job_type?: string | null;
  worker_name?: string | null;
  worker_phone?: string | null;
  worker_qr_id?: string | null;
  /** project_role / app role for alarm honorific */
  worker_role?: string | null;
};

type Props = {
  /** Active project for zone lookup. Empty → bridge idle. */
  projectId: string | null | undefined;
  subject?: Subject | null;
  /** Auto-start background tracking when consent already granted. Default true on native. */
  autoStart?: boolean;
};

/**
 * Mounts on mobile shells (MobileHome / WorkerPortal).
 * Tracks GPS → intersects restricted_zones → TTS + fullscreen alert.
 * Server-side unauthorized_entry (track-location) still drives admin FCM via DB trigger.
 */
export default function GeofenceAlertBridge({ projectId, subject, autoStart }: Props) {
  const [alertZone, setAlertZone] = useState<{ id: string; name: string } | null>(null);
  const zonesRef = useRef<RestrictedZoneGeom[]>([]);
  const subjectRef = useRef<Subject | null>(subject || null);
  const lastAlertAt = useRef(0);
  const stopRef = useRef<null | (() => void)>(null);
  const activeZoneId = useRef<string | null>(null);

  useEffect(() => {
    subjectRef.current = subject || null;
  }, [subject]);

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
      if (prev.id === "unknown" || prev.id === "zone") return null;
      return zonesRef.current.some((z) => z.id === prev.id) ? prev : null;
    });
    if (activeZoneId.current && !zonesRef.current.some((z) => z.id === activeZoneId.current)) {
      activeZoneId.current = null;
    }
  }, [projectId]);

  useEffect(() => {
    void loadZones();
  }, [loadZones]);

  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`bridge-rz-${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "restricted_zones", filter: `project_id=eq.${projectId}` },
        () => {
          void loadZones();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [projectId, loadZones]);

  const evaluate = (lat: number, lng: number) => {
    const sub = subjectRef.current || {};
    const hit = findViolatingRestrictedZone(lat, lng, zonesRef.current, sub);
    if (!hit) {
      if (activeZoneId.current) {
        activeZoneId.current = null;
        setAlertZone(null);
      }
      return;
    }
    const now = Date.now();
    if (activeZoneId.current === hit.id && now - lastAlertAt.current < 30_000) return;
    activeZoneId.current = hit.id;
    lastAlertAt.current = now;
    setAlertZone({ id: hit.id, name: hit.name });

    // Fire server event for admin push (idempotent-ish via track-location unauthorized path)
    if (projectId) {
      void supabase.functions.invoke("track-location", {
        body: {
          project_id: projectId,
          worker_id: sub.worker_id,
          worker_qr_id: sub.worker_qr_id,
          worker_name: sub.worker_name,
          worker_phone: sub.worker_phone,
          worker_role: sub.worker_role,
          lat,
          lng,
          accuracy_m: 10,
          restricted_zone_id: hit.id,
          force_restricted_check: true,
        },
      });
    }
  };

  // Start tracking
  useEffect(() => {
    const shouldAuto =
      autoStart ?? (Capacitor.isNativePlatform() || hasTrackingConsent());
    if (!projectId || !shouldAuto || !hasTrackingConsent()) return;

    let cancelled = false;
    (async () => {
      try {
        const identity: TrackingIdentity = {
          project_id: projectId,
          worker_id: subject?.worker_id,
          worker_qr_id: subject?.worker_qr_id,
          worker_name: subject?.worker_name,
          worker_phone: subject?.worker_phone,
        };
        const stop = await startTracking({
          identity,
          intervals: { moving: 8_000, idle: 45_000, danger: 4_000 },
          onUpdate: (u) => {
            if (cancelled) return;
            const anyU = u as {
              event_type?: string;
              restricted_zone_id?: string;
              zone_id?: string | null;
              zone_name?: string;
            };
            const et = String(anyU.event_type || "");
            if (/^(exit|leave|depart)/i.test(et)) {
              activeZoneId.current = null;
              setAlertZone(null);
            } else if (et === "unauthorized_entry") {
              // Only entry events from server re-open — not mere presence of restricted_zone_id
              setAlertZone({
                id: anyU.restricted_zone_id || anyU.zone_id || "unknown",
                name: anyU.zone_name || "위험 구역",
              });
            }
            evaluate(u.lat, u.lng);
          },
        });
        if (cancelled) {
          stop();
          return;
        }
        stopRef.current = stop;
      } catch (e) {
        console.warn("[geofence] tracking start failed", e);
      }
    })();

    return () => {
      cancelled = true;
      stopRef.current?.();
      stopRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, subject?.worker_id, subject?.worker_phone]);

  return (
    <DangerZoneAlertModal
      open={!!alertZone}
      zoneName={alertZone?.name}
      workerName={subject?.worker_name}
      workerRole={subject?.worker_role}
      onDismiss={() => setAlertZone(null)}
    />
  );
}
