import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canAckZoneEventAccess,
  canViewZoneEventAccess,
} from "@/lib/zoneEventAccess";

const MIGRATION_PATH = "supabase/migrations/20261122123500_worker_zone_events_rls_fix.sql";
const CO_A = "11111111-1111-1111-1111-111111111111";
const CO_B = "22222222-2222-2222-2222-222222222222";

describe("PR 1-A: worker_zone_events RLS & access policy", () => {
  describe("canViewZoneEventAccess / canAckZoneEventAccess matrix", () => {
    it("allows master globally for both view and ack", () => {
      expect(canViewZoneEventAccess({ isMaster: true })).toBe(true);
      expect(canAckZoneEventAccess({ isMaster: true })).toBe(true);
    });

    it("allows project_admin and OWNER_PM/OWNER_CM project-wide for both view and ack", () => {
      for (const subject of [
        { role: "project_admin", canReadCompanyData: false, userCompanyId: CO_A, violatorCompanyId: CO_B },
        { role: "safety_manager", position: "OWNER_PM", canReadCompanyData: false, userCompanyId: CO_A, violatorCompanyId: null },
        { role: "site_manager", position: "OWNER_CM", canReadCompanyData: false, userCompanyId: CO_A, violatorCompanyId: CO_B },
      ]) {
        expect(canViewZoneEventAccess(subject)).toBe(true);
        expect(canAckZoneEventAccess(subject)).toBe(true);
      }
    });

    it("matches push recipients for ack: exact same company only (even if GC/client can view wider scope)", () => {
      for (const role of ["safety_manager", "site_manager", "site_supervisor"]) {
        // Same company -> view + ack allowed
        expect(
          canViewZoneEventAccess({ role, canReadCompanyData: true, userCompanyId: CO_A, violatorCompanyId: CO_A }),
        ).toBe(true);
        expect(
          canAckZoneEventAccess({ role, canReadCompanyData: true, userCompanyId: CO_A, violatorCompanyId: CO_A }),
        ).toBe(true);

        // Overseeing GC/client viewing child/other company -> view allowed, ack DENIED (not push recipient)
        expect(
          canViewZoneEventAccess({ role, canReadCompanyData: true, userCompanyId: CO_A, violatorCompanyId: CO_B }),
        ).toBe(true);
        expect(
          canAckZoneEventAccess({ role, canReadCompanyData: true, userCompanyId: CO_A, violatorCompanyId: CO_B }),
        ).toBe(false);

        // Unrelated company -> both denied
        expect(
          canViewZoneEventAccess({ role, canReadCompanyData: false, userCompanyId: CO_A, violatorCompanyId: CO_B }),
        ).toBe(false);
        expect(
          canAckZoneEventAccess({ role, canReadCompanyData: false, userCompanyId: CO_A, violatorCompanyId: CO_B }),
        ).toBe(false);

        // Null violator company -> company manager cannot ack (only master / project_admin)
        expect(
          canAckZoneEventAccess({ role, canReadCompanyData: true, userCompanyId: CO_A, violatorCompanyId: null }),
        ).toBe(false);
      }
    });

    it("allows supervisor role to view in-scope events, and ack only with matching push position + same company", () => {
      expect(
        canViewZoneEventAccess({ role: "supervisor", canReadCompanyData: true }),
      ).toBe(true);
      expect(
        canAckZoneEventAccess({ role: "supervisor", userCompanyId: CO_A, violatorCompanyId: CO_A }),
      ).toBe(false);
      expect(
        canAckZoneEventAccess({
          role: "supervisor",
          position: "SUPERVISOR",
          userCompanyId: CO_A,
          violatorCompanyId: CO_A,
        }),
      ).toBe(true);
      expect(
        canAckZoneEventAccess({
          role: "supervisor",
          position: "SUPERVISOR",
          userCompanyId: CO_A,
          violatorCompanyId: CO_B,
        }),
      ).toBe(false);
    });

    it("restricts client_safety_viewer to read-only (view yes, ack never)", () => {
      expect(
        canViewZoneEventAccess({
          role: "viewer",
          isClientSafetyViewer: true,
          canReadCompanyData: true,
        }),
      ).toBe(true);
      expect(
        canAckZoneEventAccess({
          role: "viewer",
          position: "OWNER_PM",
          isClientSafetyViewer: true,
          userCompanyId: CO_A,
          violatorCompanyId: CO_A,
        }),
      ).toBe(false);
    });

    it("strictly blocks plain worker and non-safety viewer even with stale manager positions", () => {
      for (const subject of [
        { role: "worker", canReadCompanyData: true, userCompanyId: CO_A, violatorCompanyId: CO_A },
        { role: "worker", position: "SITE_SUPERVISOR", canReadCompanyData: true, userCompanyId: CO_A, violatorCompanyId: CO_A },
        { role: "viewer", canReadCompanyData: true, userCompanyId: CO_A, violatorCompanyId: CO_A },
        { role: "viewer", position: "SUPERVISOR", canReadCompanyData: true, userCompanyId: CO_A, violatorCompanyId: CO_A },
      ]) {
        expect(canViewZoneEventAccess(subject)).toBe(false);
        expect(canAckZoneEventAccess(subject)).toBe(false);
      }
    });
  });

  describe("SQL migration & access-policy invariants", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8").replace(/\r\n/g, "\n");
    const policyDoc = readFileSync("docs/access-policy.md", "utf8").replace(/\r\n/g, "\n");

    it("joins workers.id directly without retired worker_daily_qr branch", () => {
      expect(sql).toContain("FROM public.workers w\n     WHERE w.id = _worker_qr_id");
      expect(sql).not.toContain("FROM public.worker_daily_qr");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_wze_worker_qr_id");
    });

    it("enforces exact same company match in can_ack_zone_event (not wider can_access_company_data)", () => {
      const ackFn = sql.split("CREATE OR REPLACE FUNCTION public.can_ack_zone_event")[1]?.split("CREATE OR REPLACE FUNCTION")[0] || "";
      expect(ackFn).toContain("AND pm.company_id = _company_id");
      expect(ackFn).not.toContain("can_access_company_data");
    });

    it("uses (SELECT auth.uid()) internally, guards immutable columns, and locks down helper grants", () => {
      expect(sql).toContain("_uid uuid := (SELECT auth.uid())");
      expect(sql).toContain("CREATE TRIGGER trg_worker_zone_events_ack_guard");
      expect(sql).toContain("IF _uid IS NULL OR public.is_master(_uid) THEN");
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
      expect(policyDoc).toContain("pm.company_id = violator_company_id");
      expect(policyDoc).toContain("2026-11-22");
    });
  });
});
