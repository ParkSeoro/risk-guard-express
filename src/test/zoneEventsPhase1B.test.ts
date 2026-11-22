import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  computeActiveDangerResiduals,
  computeLogRangeSinceIso,
  resolveInitialZoneEventsTab,
  resolveZoneEventName,
  zoneEventWorkerKey,
  type ZoneEventRecord,
} from "@/lib/zoneEventsQuery";

function makeEvent(overrides: Partial<ZoneEventRecord>): ZoneEventRecord {
  return {
    id: overrides.id ?? "ev-1",
    project_id: "proj-1",
    zone_id: null,
    restricted_zone_id: "rz-1",
    worker_qr_id: "worker-1",
    worker_name: "홍길동",
    worker_phone: "010-1234-5678",
    event_type: "unauthorized_entry",
    acknowledged: false,
    acknowledged_at: null,
    created_at: "2026-11-22T01:00:00Z",
    ...overrides,
  };
}

describe("PR 1-B: Dashboard alert accuracy & ZoneEvents query/join fixes", () => {
  describe("resolveZoneEventName", () => {
    it("prefers restricted_zones over legacy site_zones", () => {
      expect(
        resolveZoneEventName({
          restricted_zone_id: "rz-1",
          zone_id: "sz-1",
          restricted_zone: { name: "크레인 양중 반경" },
          zone: { name: "구 구역" },
        }),
      ).toBe("크레인 양중 반경");
    });

    it("falls back to legacy site_zones when restricted_zone is absent", () => {
      expect(
        resolveZoneEventName({
          restricted_zone_id: null,
          zone_id: "sz-1",
          restricted_zone: null,
          zone: { name: "A동 배관구역" },
        }),
      ).toBe("A동 배관구역");
    });

    it("distinguishes deleted zone id vs unassigned null ids", () => {
      expect(
        resolveZoneEventName({
          restricted_zone_id: "rz-deleted",
          zone_id: null,
          restricted_zone: null,
          zone: null,
        }),
      ).toBe("(구역 삭제됨)");
      expect(
        resolveZoneEventName({
          restricted_zone_id: null,
          zone_id: null,
          restricted_zone: null,
          zone: null,
        }),
      ).toBe("(구역 미지정)");
    });
  });

  describe("computeActiveDangerResiduals", () => {
    it("returns unauthorized_entry without subsequent exit and clears on matching exit", () => {
      const events: ZoneEventRecord[] = [
        // Worker 1 entered rz-1 then exited rz-1 -> cleared
        makeEvent({ id: "1", worker_qr_id: "w1", restricted_zone_id: "rz-1", event_type: "unauthorized_entry", created_at: "2026-11-22T00:10:00Z" }),
        makeEvent({ id: "2", worker_qr_id: "w1", restricted_zone_id: "rz-1", event_type: "exit", created_at: "2026-11-22T00:20:00Z" }),
        // Worker 2 entered rz-2 and has not exited -> residual
        makeEvent({ id: "3", worker_qr_id: "w2", restricted_zone_id: "rz-2", event_type: "unauthorized_entry", created_at: "2026-11-22T00:30:00Z" }),
        // Worker 3 had normal entry only -> NOT a danger-zone residual
        makeEvent({ id: "4", worker_qr_id: "w3", restricted_zone_id: null, zone_id: "sz-1", event_type: "entry", created_at: "2026-11-22T00:40:00Z" }),
      ];
      const residual = computeActiveDangerResiduals(events);
      expect(residual.map((e) => e.id)).toEqual(["3"]);
    });

    it("clears all zones for a worker when an exit arrives with no zone id", () => {
      const events: ZoneEventRecord[] = [
        makeEvent({ id: "1", worker_qr_id: "w1", restricted_zone_id: "rz-1", event_type: "unauthorized_entry", created_at: "2026-11-22T00:10:00Z" }),
        makeEvent({ id: "2", worker_qr_id: "w1", restricted_zone_id: null, zone_id: null, event_type: "exit", created_at: "2026-11-22T00:25:00Z" }),
      ];
      expect(computeActiveDangerResiduals(events)).toEqual([]);
    });

    it("tracks latest worker zone state across A->B transitions and Danger->Normal->Exit", () => {
      const events: ZoneEventRecord[] = [
        // Worker 1 moved Danger A -> Danger B (track-location emits no exit(A)) -> only B remains residual
        makeEvent({ id: "a", worker_qr_id: "w1", restricted_zone_id: "rz-A", event_type: "unauthorized_entry", created_at: "2026-11-22T00:10:00Z" }),
        makeEvent({ id: "b", worker_qr_id: "w1", restricted_zone_id: "rz-B", event_type: "unauthorized_entry", created_at: "2026-11-22T00:20:00Z" }),
        // Worker 2 moved Danger A -> Normal entry -> Exit(normal) -> cleared (no longer in Danger A)
        makeEvent({ id: "c", worker_qr_id: "w2", restricted_zone_id: "rz-A", event_type: "unauthorized_entry", created_at: "2026-11-22T00:11:00Z" }),
        makeEvent({ id: "d", worker_qr_id: "w2", restricted_zone_id: null, zone_id: "sz-normal", event_type: "entry", created_at: "2026-11-22T00:15:00Z" }),
        makeEvent({ id: "e", worker_qr_id: "w2", restricted_zone_id: null, zone_id: "sz-normal", event_type: "exit", created_at: "2026-11-22T00:25:00Z" }),
      ];
      expect(computeActiveDangerResiduals(events).map((e) => e.id)).toEqual(["b"]);
    });

    it("handles worker_qr_id preference and phone-digit normalization", () => {
      expect(zoneEventWorkerKey({ worker_qr_id: "w-1", worker_phone: "010-1111-2222", worker_name: "김철수" })).toBe("id:w-1");
      expect(zoneEventWorkerKey({ worker_qr_id: null, worker_phone: "010-1111-2222", worker_name: "김철수" })).toBe("phone:01011112222");
    });
  });

  describe("computeLogRangeSinceIso & tab resolver", () => {
    it("computes KST midnight boundaries cleanly", () => {
      expect(computeLogRangeSinceIso("today", "2026-11-22")).toBe("2026-11-21T15:00:00.000Z");
      expect(computeLogRangeSinceIso("7d", "2026-11-22")).toBe("2026-11-15T15:00:00.000Z");
      expect(computeLogRangeSinceIso("all", "2026-11-22")).toBeNull();
    });

    it("resolves explicit tab query param and ?ack=open", () => {
      expect(resolveInitialZoneEventsTab(new URLSearchParams("tab=all"))).toBe("all");
      expect(resolveInitialZoneEventsTab(new URLSearchParams("tab=residual"))).toBe("residual");
      expect(resolveInitialZoneEventsTab(new URLSearchParams("ack=open"))).toBe("alerts");
    });
  });

  describe("Dashboard & ZoneEvents source regression guards", () => {
    const dashSrc = readFileSync("src/pages/Dashboard.tsx", "utf8").replace(/\r\n/g, "\n");
    const zeSrc = readFileSync("src/pages/ZoneEvents.tsx", "utf8").replace(/\r\n/g, "\n");

    it("filters Dashboard zoneAlerts strictly to unacknowledged unauthorized_entry with 3-min TTL", () => {
      expect(dashSrc).toContain("const DASHBOARD_CACHE_TTL_MS = 3 * 60 * 1000;");
      expect(dashSrc).toMatch(
        /\.from\("worker_zone_events"\)[\s\S]*?\.eq\("event_type", "unauthorized_entry"\)[\s\S]*?\.eq\("acknowledged", false\)/,
      );
    });

    it("joins restricted_zones and splits unacknowledged alert query in ZoneEvents", () => {
      expect(zeSrc).toContain("restricted_zone:restricted_zones(name, zone_category, zone_color)");
      expect(zeSrc).toContain('.eq("event_type", "unauthorized_entry")');
      expect(zeSrc).toContain("computeActiveDangerResiduals");
      expect(zeSrc).not.toContain('(e.worker_name || "") + "|" + (e.worker_phone || "")');
    });
  });
});
