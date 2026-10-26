import { isPresenceZoneCategory } from "./accessRules";

/**
 * Display-only probe. Matches track-location's restricted_zones filter:
 * is_deleted = false, is_active = true, and zone_category is not a presence
 * category (일반 / 작업구역 never alarm).
 */
export type AlarmZoneProbe = {
  is_active?: boolean | null;
  is_deleted?: boolean | null;
  zone_category?: string | null;
};

export const NO_ACTIVE_DANGER_ZONE_MESSAGE =
  "이 현장에는 활성 위험구역이 없어 위험구역 진입 경보가 울리지 않습니다. 위험구역을 등록해 주세요.";

export function isActiveAlarmingZone(zone: AlarmZoneProbe | null | undefined): boolean {
  if (!zone) return false;
  if (zone.is_deleted === true) return false;
  if (zone.is_active !== true) return false;
  if (isPresenceZoneCategory(zone.zone_category)) return false;
  return true;
}

export function hasActiveAlarmingZones(
  zones: readonly AlarmZoneProbe[] | null | undefined,
): boolean {
  return (zones ?? []).some((zone) => isActiveAlarmingZone(zone));
}
