import { describe, expect, it } from "vitest";
import {
  hasActiveAlarmingZones,
  isActiveAlarmingZone,
} from "@/lib/tracking/activeAlarmZones";

describe("hasActiveAlarmingZones", () => {
  it("ignores presence categories that never alarm", () => {
    expect(isActiveAlarmingZone({ is_active: true, zone_category: "일반" })).toBe(false);
    expect(isActiveAlarmingZone({ is_active: true, zone_category: "작업구역" })).toBe(false);
    expect(
      hasActiveAlarmingZones([
        { is_active: true, zone_category: "일반" },
        { is_active: true, zone_category: "작업구역" },
      ]),
    ).toBe(false);
  });

  it("counts an active non-presence zone, including a null category", () => {
    expect(isActiveAlarmingZone({ is_active: true, zone_category: "추락위험" })).toBe(true);
    expect(isActiveAlarmingZone({ is_active: true, zone_category: null })).toBe(true);
    expect(
      hasActiveAlarmingZones([
        { is_active: true, zone_category: "일반" },
        { is_active: true, is_deleted: false, zone_category: "공정(위험)구역" },
      ]),
    ).toBe(true);
  });

  it("skips inactive, deleted, and empty lists", () => {
    expect(isActiveAlarmingZone({ is_active: false, zone_category: "화재위험" })).toBe(false);
    expect(isActiveAlarmingZone({ is_active: null, zone_category: "화재위험" })).toBe(false);
    expect(
      isActiveAlarmingZone({ is_active: true, is_deleted: true, zone_category: "감전위험" }),
    ).toBe(false);
    expect(hasActiveAlarmingZones([])).toBe(false);
    expect(hasActiveAlarmingZones(null)).toBe(false);
  });
});
