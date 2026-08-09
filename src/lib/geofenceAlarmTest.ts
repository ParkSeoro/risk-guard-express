import { supabase } from "@/integrations/supabase/client";
import {
  encodeRoleLabelInNotes,
  formatAlarmSubject,
  type AlarmRoleInput,
} from "@/lib/alarmRoleLabel";

/**
 * Master-only alarm simulator: skip GPS, force full alert cycle.
 * - Local TTS/siren: caller opens DangerZoneAlertModal (single playback owner)
 * - Server: insert unauthorized_entry → trg_zone_event_notify → FCM push
 *   Recipients: violator self + project_admin (project-wide) + violator company managers
 */
export async function simulateDangerZoneAlert(opts: {
  projectId: string;
  workerName?: string | null;
  workerRole?: AlarmRoleInput;
  zoneName?: string | null;
}): Promise<{ ok: boolean; error?: string; eventId?: string }> {
  const displayName = opts.workerName?.trim() || "테스트 사용자";
  const role = opts.workerRole || "master";
  const subject = formatAlarmSubject(displayName, role);
  const zoneLabel = opts.zoneName?.trim() || "시뮬레이션 위험구역";

  try {
    const { data, error } = await supabase
      .from("worker_zone_events")
      .insert({
        project_id: opts.projectId,
        zone_id: null,
        restricted_zone_id: null,
        worker_name: displayName,
        worker_phone: null,
        worker_qr_id: null,
        event_type: "unauthorized_entry",
        source: "alarm_sim",
        notes: encodeRoleLabelInNotes(`[ALARM_SIM] ${zoneLabel}`, role),
        lat: null,
        lng: null,
      } as any)
      .select("id")
      .single();

    if (error) {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (uid) {
        await supabase.from("notifications").insert({
          user_id: uid,
          project_id: opts.projectId,
          type: "danger_zone_entry",
          title: `🚨 긴급: ${subject} 위험 구역 진입`,
          message: `${subject}이(가) ${zoneLabel}에 진입했습니다. (시뮬레이션)`,
          body: `${subject}이(가) ${zoneLabel}에 진입했습니다. (시뮬레이션)`,
          related_type: "zone_event",
          related_id: null,
          link: `/zone-events?project=${opts.projectId}`,
          severity: "high",
          is_read: false,
        } as any);
      }
      return { ok: true, error: error.message };
    }

    return { ok: true, eventId: data?.id };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
