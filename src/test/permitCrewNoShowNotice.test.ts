import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20261102181000_permit_crew_no_show_notice.sql",
  "utf8",
);

describe("permit crew no-show notice", () => {
  it("notifies approved permit crew only and does not write attendance", () => {
    expect(sql).toContain("notify_permit_crew_no_shows");
    expect(sql).toContain("'0 1 * * *'");
    expect(sql).toContain("hire_date IS NULL OR w.hire_date <= v_day");
    expect(sql).toContain("'승인완료'");
    expect(sql).toContain("permit_crew_no_show_summary");
    expect(sql).not.toContain("UPDATE public.worker_entry_logs");
    expect(sql).not.toContain("INSERT INTO public.worker_entry_logs");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.notify_permit_crew_no_shows\(\) FROM PUBLIC, anon, authenticated/);
  });
});
