import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  countMapsForSpot,
  mapSpotBadgeLabel,
  pickMapForSpot,
} from "@/lib/map/multiSpotMapSelection";

describe("SiteControlMap Phase 2 — multi-spot drone map linking & backward compatibility", () => {
  const spots = [
    { id: "spot-a", name: "1공구 패드" },
    { id: "spot-b", name: "2공구 적량동" },
  ];

  const maps = [
    { id: "m-shared", site_spot_id: null },
    { id: "m-a", site_spot_id: "spot-a" },
    { id: "m-b", site_spot_id: "spot-b" },
  ];

  it("picks exact spot-linked map first, then shared (null), then first map", () => {
    expect(pickMapForSpot(maps, "spot-a")?.id).toBe("m-a");
    expect(pickMapForSpot(maps, "spot-b")?.id).toBe("m-b");
    expect(pickMapForSpot(maps, "spot-unknown")?.id).toBe("m-shared");
    expect(pickMapForSpot(maps, null)?.id).toBe("m-shared");
    expect(pickMapForSpot([{ id: "m-only", site_spot_id: "spot-a" }], "spot-b")?.id).toBe("m-only");
    expect(pickMapForSpot([], "spot-a")).toBeNull();
  });

  it("formats spot badge labels and counts linked maps accurately", () => {
    expect(mapSpotBadgeLabel(null, spots)).toBe("공용 (전체)");
    expect(mapSpotBadgeLabel("spot-a", spots)).toBe("1공구 패드");
    expect(mapSpotBadgeLabel("deleted-spot", spots)).toBe("공용 (전체)");
    expect(countMapsForSpot(maps, "spot-a")).toBe(1);
    expect(countMapsForSpot(maps, "spot-c")).toBe(0);
  });

  it("wires additive migration and multi-spot guard across SiteControlMap, WorkerDistribution, MobileMapCalibration", () => {
    const sql = readFileSync(
      "supabase/migrations/20261125021500_site_maps_add_site_spot_id.sql",
      "utf8",
    );
    const scm = readFileSync("src/pages/SiteControlMap.tsx", "utf8");
    const dist = readFileSync("src/pages/WorkerDistribution.tsx", "utf8");
    const mob = readFileSync("src/pages/MobileMapCalibration.tsx", "utf8");

    expect(sql).toContain("ADD COLUMN IF NOT EXISTS site_spot_id uuid NULL");
    expect(sql).toContain("ON DELETE SET NULL");
    expect(scm).toContain("onLinkMapToSpot");
    expect(scm).toContain("focusSpotAndMap");
    expect(dist).toContain("site_spot_id");
    expect(mob).toContain("hasMultiSpotMaps");
    expect(mob).toContain("_clear_gps_calibration: !hasMultiSpotMaps");
  });
});
