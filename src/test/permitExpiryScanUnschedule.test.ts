import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20261104180000_unschedule_permit_expiry_scan.sql",
  "utf8",
);

describe("permit expiry scan is not scheduled", () => {
  it("removes the repeating job and does not register it again", () => {
    expect(sql).toContain("scan-permit-expiries");
    expect(sql).toContain("cron.unschedule");
    expect(sql).not.toContain("cron.schedule");
    expect(sql).not.toContain("promote_permits_to_closure_pending");
    expect(sql).not.toContain("scan_work_plan_end_warnings");
  });

  it("stops anonymous and signed-in clients from running the scan", () => {
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.scan_permit_expiries()");
    expect(sql).toContain("anon, authenticated");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.scan_permit_expiries() TO service_role");
  });
});
