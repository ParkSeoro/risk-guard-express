import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const original = readFileSync(
  "supabase/migrations/20261102181000_permit_crew_no_show_notice.sql",
  "utf8",
);
const sql = readFileSync(
  "supabase/migrations/20261103080000_permit_no_show_by_company.sql",
  "utf8",
);

describe("permit crew no-show notice", () => {
  it("notifies approved permit crew only and does not write attendance", () => {
    expect(original).toContain("'0 1 * * *'");
    expect(original).toContain("hire_date IS NULL OR w.hire_date <= v_day");
    expect(original).toMatch(/REVOKE ALL ON FUNCTION public\.notify_permit_crew_no_shows\(\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toContain("notify_permit_crew_no_shows");
    expect(sql).toContain("'승인완료'");
    expect(sql).toContain("permit_date = v_day");
    expect(sql).toContain("permit_crew_no_show_summary");
    expect(sql).toContain("IN ('project_admin', 'safety_manager', 'site_manager')");
    expect(sql).toContain("public.can_access_company_data(pm.user_id, comp.project_id, comp.company_id)");
    expect(sql).toContain("IS NOT DISTINCT FROM comp.company_id::text");
    expect(sql).toContain("GROUP BY x.project_id, x.company_id");
    expect((sql.match(/INSERT INTO public\.notifications/g) || []).length).toBe(2);
    expect(sql).not.toContain("permit_no_show_visible");
    expect(sql).not.toContain("list_attendance_exceptions");
    expect(sql).not.toContain("cron.schedule");
    expect(sql).not.toContain("UPDATE public.worker_entry_logs");
    expect(sql).not.toContain("INSERT INTO public.worker_entry_logs");
    expect(sql).not.toContain("'작업취소'");
  });
});
