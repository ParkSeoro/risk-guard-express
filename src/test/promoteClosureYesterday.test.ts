import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/applied-manually/20261024_promote_permits_to_closure_pending.sql",
  "utf8",
);
const body = sql.slice(sql.indexOf("AS $function$"));

function guarded(updateSql: string) {
  const updateAt = body.indexOf(updateSql);
  const armAt = body.lastIndexOf("set_config('app.skip_work_permit_edit_lock', '1', true)", updateAt);
  const restoreAt = body.indexOf(
    "set_config('app.skip_work_permit_edit_lock', COALESCE(v_lock, ''), true)",
    updateAt,
  );
  return { updateAt, armAt, restoreAt };
}

describe("promote_permits_to_closure_pending yesterday window", () => {
  it("promotes only yesterday and skips the permit lock around both status updates", () => {
    expect(body).toContain(
      "IF v_eff_date IS NULL OR v_eff_date >= CURRENT_DATE OR v_eff_date < CURRENT_DATE - 1 THEN",
    );
    expect(body).toContain("(r.extension_until)::date");
    expect(body).not.toContain("set_config('app.skip_work_permit_edit_lock', '1', false)");
    expect(body).not.toContain("permit_gas_closure_gate");

    const first = guarded(
      "UPDATE public.work_permits\n         SET status = '종료대기', updated_at = now()\n       WHERE id = r.id AND status IS DISTINCT FROM '종료대기';",
    );
    const second = guarded(
      "UPDATE public.work_permits\n       SET status = '종료대기', updated_at = now()\n     WHERE id = r.id;",
    );
    for (const site of [first, second]) {
      expect(site.updateAt).toBeGreaterThan(0);
      expect(site.armAt).toBeGreaterThan(0);
      expect(site.armAt).toBeLessThan(site.updateAt);
      expect(site.restoreAt).toBeGreaterThan(site.updateAt);
    }
    expect(second.armAt).toBeGreaterThan(first.restoreAt);
  });
});
