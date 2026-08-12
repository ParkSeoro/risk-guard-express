/**
 * Admin-push fast path body for track-location.
 * Contract: lat/lng MUST be device raw GPS — the edge function applies
 * projects.gps_calibration exactly once. Never send map-aligned coords here.
 */
export type GeofenceAdminPushSubject = {
  worker_id?: string | null;
  worker_qr_id?: string | null;
  worker_name?: string | null;
  worker_phone?: string | null;
  company_id?: string | null;
  worker_role?: string | null;
};

export function buildGeofenceAdminPushBody(args: {
  projectId: string;
  subject?: GeofenceAdminPushSubject | null;
  /** Device raw GPS (not applyGpsCalibration output). */
  rawLat: number;
  rawLng: number;
  accuracyM: number;
  restrictedZoneId: string;
}) {
  const sub = args.subject || {};
  return {
    project_id: args.projectId,
    worker_id: sub.worker_id,
    worker_qr_id: sub.worker_qr_id,
    worker_name: sub.worker_name,
    worker_phone: sub.worker_phone,
    company_id: sub.company_id,
    worker_role: sub.worker_role,
    lat: args.rawLat,
    lng: args.rawLng,
    accuracy_m: args.accuracyM,
    restricted_zone_id: args.restrictedZoneId,
    force_restricted_check: true as const,
  };
}
