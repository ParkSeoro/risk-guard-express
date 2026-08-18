/**
 * Platform master GPS: default is the same site fence as other managers
 * (no home OS icon / last-position dot).
 *
 * Opt-in "현장 외 알람 테스트" skips the boot probe and auto-stop so a master
 * can test restricted-zone sirens with real GPS. Presence (worker_last_positions)
 * stays suppressed in that mode.
 */

export const MASTER_OFFSITE_ALARM_TEST_KEY = "safenex.masterOffsiteAlarmTest";
export const MASTER_OFFSITE_ALARM_TEST_EVENT = "mobile:master-offsite-alarm-test";

export function isPlatformMaster(
  hasRole: (role: string) => boolean,
  roles?: string[] | null,
): boolean {
  if (hasRole("master")) return true;
  return (roles || []).some((r) => String(r).toLowerCase() === "master");
}

export function readMasterOffsiteAlarmTest(): boolean {
  try {
    return localStorage.getItem(MASTER_OFFSITE_ALARM_TEST_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeMasterOffsiteAlarmTest(on: boolean): void {
  try {
    localStorage.setItem(MASTER_OFFSITE_ALARM_TEST_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(MASTER_OFFSITE_ALARM_TEST_EVENT, { detail: { on } }));
  } catch {
    /* ignore */
  }
}
