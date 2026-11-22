import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canAckZoneEventAccess,
  canViewZoneEventAccess,
} from "@/lib/zoneEventAccess";

const MIGRATION_PATH = "supabase/migrations/20261122123500_worker_zone_events_rls_fix.sql";

describe("PR 1-A: worker_zone_events RLS & access policy", () => {
  describe("canViewZoneEventAccess / canAckZoneEventAccess matrix", () => {
    it("allows master globally for both view and ack", () => {
      expect(canViewZoneEventAccess({ isMaster: true })).toBe(true);
      expect(canAckZoneEventAccess({ isMaster: true })).toBe(true);
    });

    it("allows project_admin and OWNER_PM/OWNER_CM project-wide for both view and ack", () => {
      for (const subject of [
        { role: "project_admin", canReadCompanyData: false, canAccessCompanyData: false },
        { role: "safety_manager", position: "OWNER_PM", canReadCompanyData: false, canAccessCompanyData: false },
        { role: "site_manager", position: "OWNER_CM", canReadCompanyData: false, canAccessCompanyData: false },
      ]) {
        expect(canViewZoneEventAccess(subject)).toBe(true);
        expect(canAckZoneEventAccess(subject)).toBe(true);
      }
    });

    it("scopes safety_manager, site_manager, site_supervisor to company data for view & ack", () => {
      for (const role of ["safety_manager", "site_manager", "site_supervisor"]) {
        // Own / child company
        expect(
          canViewZoneEventAccess({ role, canReadCompanyData: true, canAccessCompanyData: true }),
        ).toBe(true);
        expect(
          canAckZoneEventAccess({ role, canReadCompanyData: true, canAccessCompanyData: true }),
        ).toBe(true);
        // Other company (out of scope)
        expect(
          canViewZoneEventAccess({ role, canReadCompanyData: false, canAccessCompanyData: false }),
        ).toBe(false);
        expect(
          canAckZoneEventAccess({ role, canReadCompanyData: false, canAccessCompanyData: false }),
        ).toBe(false);
      }
    });

    it("allows supervisor role to view in-scope events, and ack only with matching push position", () => {
      expect(
        canViewZoneEventAccess({ role: "supervisor", canReadCompanyData: true }),
      ).toBe(true);
      expect(
        canAckZoneEventAccess({ role: "supervisor", canAccessCompanyData: true }),
      ).toBe(false);
      expect(
        canAckZoneEventAccess({
          role: "supervisor",
          position: "SUPERVISOR",
          canAccessCompanyData: true,
        }),
      ).toBe(true);
    });

    it("restricts client_safety_viewer to read-only (view yes, ack never)", () => {
      expect(
        canViewZoneEventAccess({
          role: "viewer",
          isClientSafetyViewer: true,
          canReadCompanyData: true,
          canAccessCompanyData: false,
        }),
      ).toBe(true);
      expect(
        canAckZoneEventAccess({
          role: "viewer",
          position: "OWNER_PM",
          isClientSafetyViewer: true,
          canReadCompanyData: true,
          canAccessCompanyData: true,
        }),
      ).toBe(false);
    });

    it("strictly blocks plain worker and non-safety viewer from both view and ack", () => {
      for (const subject of [
        { role: "worker", canReadCompanyData: true, canAccessCompanyData: true },
        { role: "worker", position: "SITE_SUPERVISOR", canReadCompanyData: true, canAccessCompanyData: true },
        { role: "viewer", canReadCompanyData: true, canAccessCompanyData: true },
      ]) {
        expect(canViewZoneEventAccess(subject)).toBe(false);
        expect(canAckZoneEventAccess(subject)).toBe(false);
      }
    });
  });

  describe("SQL migration & access-policy invariants", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8").replace(/\r\n/g, "\n");
    const policyDoc = readFileSync("docs/access-policy.md", "utf8").replace(/\r\n/g, "\n");

    it("joins workers.id directly and keeps worker_daily_qr only as legacy fallback", () => {
      expect(sql).toContain("FROM public.workers w\n     WHERE w.id = _worker_qr_id");
      expect(sql).toContain("FROM public.worker_daily_qr q");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_wze_worker_qr_id");
    });

    it("uses (SELECT auth.uid()) internally and locks down helper grants", () => {
      expect(sql).toContain("_uid uuid := (SELECT auth.uid())");
      expect(sql).toContain(
        "REVOKE ALL ON FUNCTION public.resolve_zone_event_company_id(uuid, uuid, text)\n  FROM PUBLIC, anon, authenticated;",
      );
      expect(sql).toContain(
        "REVOKE ALL ON FUNCTION public.can_view_zone_event(uuid, uuid, text) FROM PUBLIC, anon;",
      );
      expect(sql).toContain(
        "REVOKE ALL ON FUNCTION public.can_ack_zone_event(uuid, uuid, text) FROM PUBLIC, anon;",
      );
    });

    it("applies TO authenticated and both USING + WITH CHECK on UPDATE policy", () => {
      expect(sql).toMatch(
        /CREATE POLICY "admins view zone events"[\s\S]*?FOR SELECT[\s\S]*?TO authenticated[\s\S]*?USING \(public\.can_view_zone_event\(project_id, worker_qr_id, worker_phone\)\)/,
      );
      expect(sql).toMatch(
        /CREATE POLICY "members ack events"[\s\S]*?FOR UPDATE[\s\S]*?TO authenticated[\s\S]*?USING \(public\.can_ack_zone_event\(project_id, worker_qr_id, worker_phone\)\)[\s\S]*?WITH CHECK \(public\.can_ack_zone_event\(project_id, worker_qr_id, worker_phone\)\)/,
      );
      expect(sql).not.toContain("auth.role()");
    });

    it("documents location / zone-event access rules in docs/access-policy.md", () => {
      expect(policyDoc).toContain("## 위치 · 구역 경보 · 분포");
      expect(policyDoc).toContain("worker_zone_events");
      expect(policyDoc).toContain("2026-11-22");
    });
  });
});
