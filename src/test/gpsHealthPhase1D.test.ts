import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatGpsBlockReason } from "@/lib/tracking/gpsTrackingHealth";

describe("PR 1-D: GPS tracking health denominator & exceptions gps_blocked fixes", () => {
  describe("formatGpsBlockReason", () => {
    it("maps raw GPS block_reason codes into Korean", () => {
      expect(formatGpsBlockReason("no_consent")).toBe("위치 동의 없음");
      expect(formatGpsBlockReason("no_permission")).toBe("앱 위치 권한 없음");
      expect(formatGpsBlockReason("no_checkin")).toBe("미출근");
      expect(formatGpsBlockReason("fence_probe_failed")).toBe("현장 펜스 밖");
      expect(formatGpsBlockReason("identity_mismatch")).toBe("명부 신원 불일치");
      expect(formatGpsBlockReason(null)).toBeNull();
      expect(formatGpsBlockReason("")).toBeNull();
    });
  });

  describe("SQL & UI regression guards", () => {
    const sql = readFileSync(
      "supabase/migrations/20261122133500_gps_health_and_exceptions_fix.sql",
      "utf8",
    ).replace(/\r\n/g, "\n");
    const healthSrc = readFileSync("src/pages/AdminTrackingHealth.tsx", "utf8").replace(/\r\n/g, "\n");
    const exBoardSrc = readFileSync(
      "src/components/workers/WorkerExceptionBoard.tsx",
      "utf8",
    ).replace(/\r\n/g, "\n");
    const laborSrc = readFileSync("src/lib/laborEvidence.ts", "utf8").replace(/\r\n/g, "\n");

    it("bases get_gps_tracking_health on today's open worker_entry_logs (DISTINCT ON worker_id)", () => {
      expect(sql).toContain("SELECT DISTINCT ON (e.worker_id)");
      expect(sql).toContain("AND e.exit_at IS NULL");
      expect(sql).toContain("AND st.block_reason <> 'no_checkin'");
    });

    it("fixes list_attendance_exceptions gps_blocked to require non-null non-checkin reason + same-day entry", () => {
      const gpsSection = sql.split("'gps_blocked'")[1]?.split("'permit_crew_total'")[0] || "";
      expect(gpsSection).toContain("AND st.block_reason IS NOT NULL");
      expect(gpsSection).toContain("AND st.block_reason <> 'no_checkin'");
      expect(gpsSection).toContain("AND st.updated_at BETWEEN v_start AND v_end");
      expect(gpsSection).toContain("FROM public.worker_entry_logs e");
    });

    it("removes legacy site_zones Wi-Fi fingerprint card from AdminTrackingHealth", () => {
      expect(healthSrc).not.toContain("wifi_fingerprint");
      expect(healthSrc).not.toContain("Wi-Fi 지문");
      expect(healthSrc).not.toContain('.from("site_zones")');
      expect(healthSrc).toContain("formatGpsBlockReason");
    });

    it("localizes blockReason and supports company filtering in WorkerExceptionBoard + fallback", () => {
      expect(exBoardSrc).toContain("formatGpsBlockReason(it.blockReason)");
      expect(exBoardSrc).toContain("companyFilter");
      expect(laborSrc).toContain('.not("block_reason", "is", null)');
      expect(laborSrc).toContain('.neq("block_reason", "no_checkin")');
    });
  });
});
