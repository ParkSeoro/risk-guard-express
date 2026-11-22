import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyZoneEventLivePresence,
  ZONE_ACK_QUICK_NOTES,
} from "@/lib/zoneEventsQuery";
import type { RestrictedZoneGeom } from "@/lib/tracking/restrictedZoneGeom";

const RADIUS_ZONE: RestrictedZoneGeom = {
  id: "z-radius",
  name: "크레인 반경 위험구역",
  geometry_type: "radius",
  geo_polygon: null,
  center_lat: 37.5,
  center_lng: 127.0,
  radius_m: 30,
  banned_worker_ids: null,
  banned_company_ids: null,
  banned_job_types: null,
  zone_category: "중장비반입",
  is_active: true,
};

const POLYGON_ZONE: RestrictedZoneGeom = {
  id: "z-poly",
  name: "개구부 추락위험",
  geometry_type: "polygon",
  geo_polygon: [
    { lat: 37.501, lng: 127.0 },
    { lat: 37.501, lng: 127.002 },
    { lat: 37.499, lng: 127.002 },
    { lat: 37.499, lng: 127.0 },
  ],
  center_lat: null,
  center_lng: null,
  radius_m: null,
  banned_worker_ids: null,
  banned_company_ids: null,
  banned_job_types: null,
  zone_category: "추락위험",
  is_active: true,
};

describe("PR 2-B: ZoneEvents ack memo & live presence + WorkerExceptionBoard actions", () => {
  describe("classifyZoneEventLivePresence", () => {
    const nowMs = Date.parse("2026-11-22T06:00:00Z");
    const baseEvent = {
      event_type: "unauthorized_entry",
      restricted_zone_id: "z-radius",
      worker_qr_id: "w-1",
      created_at: "2026-11-22T05:55:00Z",
    };

    it("marks fresh position inside radius or polygon zone as inside", () => {
      const r1 = classifyZoneEventLivePresence(
        baseEvent,
        { worker_id: "w-1", lat: 37.50005, lng: 127.00005, updated_at: "2026-11-22T05:59:00Z" },
        RADIUS_ZONE,
        nowMs,
      );
      expect(r1?.status).toBe("inside");
      expect(r1?.label).toBe("현재 구역 내 체류중");

      const r2 = classifyZoneEventLivePresence(
        { ...baseEvent, restricted_zone_id: "z-poly" },
        { worker_id: "w-1", lat: 37.5, lng: 127.001, updated_at: "2026-11-22T05:59:00Z" },
        POLYGON_ZONE,
        nowMs,
      );
      expect(r2?.status).toBe("inside");
    });

    it("marks fresh position outside danger zone as left", () => {
      const r = classifyZoneEventLivePresence(
        baseEvent,
        { worker_id: "w-1", lat: 37.505, lng: 127.005, updated_at: "2026-11-22T05:59:00Z" },
        RADIUS_ZONE,
        nowMs,
      );
      expect(r?.status).toBe("left");
      expect(r?.label).toBe("구역 이탈 확인");
    });

    it("marks positions older than 15m or any position predating the event (even by 90s) as stale", () => {
      const oldPos = classifyZoneEventLivePresence(
        baseEvent,
        { worker_id: "w-1", lat: 37.5, lng: 127.0, updated_at: "2026-11-22T05:40:00Z" },
        RADIUS_ZONE,
        nowMs,
      );
      expect(oldPos?.status).toBe("stale");

      // 90s BEFORE event outside the zone must NEVER produce a false-safe "left" badge
      const preEventOutside = classifyZoneEventLivePresence(
        baseEvent,
        { worker_id: "w-1", lat: 37.505, lng: 127.005, updated_at: "2026-11-22T05:53:30Z" },
        RADIUS_ZONE,
        nowMs,
      );
      expect(preEventOutside?.status).toBe("stale");
    });

    it("returns null for non-danger events, inactive zones, or missing geometry/position", () => {
      expect(
        classifyZoneEventLivePresence(
          { ...baseEvent, event_type: "exit" },
          { worker_id: "w-1", lat: 37.5, lng: 127.0, updated_at: "2026-11-22T05:59:00Z" },
          RADIUS_ZONE,
          nowMs,
        ),
      ).toBeNull();
      expect(
        classifyZoneEventLivePresence(
          baseEvent,
          { worker_id: "w-1", lat: 37.5, lng: 127.0, updated_at: "2026-11-22T05:59:00Z" },
          { ...RADIUS_ZONE, is_active: false },
          nowMs,
        ),
      ).toBeNull();
      expect(classifyZoneEventLivePresence(baseEvent, null, RADIUS_ZONE, nowMs)).toBeNull();
      expect(
        classifyZoneEventLivePresence(
          baseEvent,
          { worker_id: "w-1", lat: 37.5, lng: 127.0, updated_at: "2026-11-22T05:59:00Z" },
          null,
          nowMs,
        ),
      ).toBeNull();
    });
  });

  describe("SQL migration & UI integration", () => {
    it("adds ack_note, protects notes & ack_note immutability after ack, and adds active-suspension check in migration", () => {
      const sql = readFileSync(
        "supabase/migrations/20261122143500_phase2b_zone_ack_note_and_suspension_exception.sql",
        "utf8",
      ).replace(/\r\n/g, "\n");
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS ack_note text");
      expect(sql).toContain("OR NEW.notes IS DISTINCT FROM OLD.notes");
      expect(sql).toContain("OR NEW.ack_note IS DISTINCT FROM OLD.ack_note");
      expect(sql).toContain("zone_event_ack_immutable");
      expect(sql).toContain("'suspended_site_entry'");
      expect(sql).toContain("w.site_entry_suspended_until > now()");
      expect(sql).toContain("public.worker_suspension_site_presence");
    });

    it("wires ack_note memo, live presence, and WorkerExceptionBoard direct correction & suspension section", () => {
      expect(ZONE_ACK_QUICK_NOTES.length).toBeGreaterThanOrEqual(4);
      const zoneSrc = readFileSync("src/pages/ZoneEvents.tsx", "utf8").replace(/\r\n/g, "\n");
      const boardSrc = readFileSync(
        "src/components/workers/WorkerExceptionBoard.tsx",
        "utf8",
      ).replace(/\r\n/g, "\n");
      const docSrc = readFileSync("docs/access-policy.md", "utf8").replace(/\r\n/g, "\n");

      expect(zoneSrc).toContain("ack_note");
      expect(zoneSrc).toContain("classifyZoneEventLivePresence");
      expect(zoneSrc).toContain("ZONE_ACK_QUICK_NOTES");
      expect(boardSrc).toContain("suspendedSiteEntry");
      expect(boardSrc).toContain("status=no_exit");
      expect(docSrc).toContain("`ack_note`");
    });
  });
});
