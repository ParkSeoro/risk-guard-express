import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function src(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("master alarm test does not write a zone entry", () => {
  it("does not insert notifications or zone events from the phone", () => {
    const fn = src("src/lib/geofenceAlarmTest.ts");
    expect(fn).not.toContain('.from("notifications")');
    expect(fn).not.toContain(".from(\"worker_zone_events\")");
    expect(fn).not.toContain("danger_zone_entry");
  });

  it("blocks client inserts of danger_zone_entry and deletes the sim rows", () => {
    const sql = src("supabase/migrations/20261024104500_block_client_sim_danger_notify.sql");
    expect(sql).toContain("IS DISTINCT FROM 'danger_zone_entry'");
    expect(sql).toContain("DELETE FROM public.notifications");
    expect(sql).toContain("시뮬레이션");
  });
});
