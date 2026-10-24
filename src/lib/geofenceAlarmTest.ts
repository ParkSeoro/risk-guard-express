import type { AlarmRoleInput } from "@/lib/alarmRoleLabel";

/**
 * Master alarm test stays on this phone.
 * A rejected zone-event write used to fall back into a push that looked like
 * a real entry on the selected project. This function no longer writes.
 */
export async function simulateDangerZoneAlert(_opts: {
  projectId: string;
  workerName?: string | null;
  workerRole?: AlarmRoleInput;
  zoneName?: string | null;
}): Promise<{ ok: boolean; error?: string; eventId?: string }> {
  return { ok: true };
}
