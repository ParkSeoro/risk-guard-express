import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/applied-manually/20261024_scan_work_plan_end_warnings.sql",
  "utf8",
);

describe("scan_work_plan_end_warnings lock skip", () => {
  it("sets the document-lock skip only for the stamp update and restores it", () => {
    const body = sql.slice(sql.indexOf("AS $function$"));
    const insertAt = body.indexOf("INSERT INTO public.notifications");
    const armAt = body.indexOf("set_config('app.skip_document_edit_lock', '1', true)");
    const updateAt = body.indexOf("UPDATE public.work_plans SET end_warning_notified_at = now()");
    const restoreAt = body.indexOf(
      "set_config('app.skip_document_edit_lock', COALESCE(_lock, ''), true)",
    );

    expect(insertAt).toBeGreaterThan(0);
    expect(armAt).toBeGreaterThan(insertAt);
    expect(updateAt).toBeGreaterThan(armAt);
    expect(restoreAt).toBeGreaterThan(updateAt);
    expect(body).not.toContain("cron.schedule");
    expect(body).not.toContain("10 15 * * *");
    expect(body).not.toContain("set_config('app.skip_document_edit_lock', '1', false)");
  });
});
