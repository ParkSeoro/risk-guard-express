import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/applied-manually/20261024_hide_qa_tbm_inactive.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/applied-manually/20261024_hide_qa_tbm_inactive_rollback.sql",
  "utf8",
);
const body = sql.slice(sql.indexOf("AS $function$"), sql.indexOf("$function$;"));

describe("hide QA TBM sessions", () => {
  it("turns is_active off only for a QA TBM inside the existing marker branch", () => {
    const activeAt = body.indexOf("NEW.is_active := false;");
    const tableAt = body.lastIndexOf("IF TG_TABLE_NAME = 'tbm_sessions' THEN", activeAt);
    const qaAt = body.lastIndexOf("starts_with(COALESCE(marker, ''), '__QA__')", activeAt);
    expect(qaAt).toBeGreaterThan(0);
    expect(tableAt).toBeGreaterThan(qaAt);
    expect(activeAt).toBeGreaterThan(tableAt);
    expect(body.indexOf("NEW.is_active", activeAt + 1)).toBe(-1);
    expect(body).toContain("to_jsonb(NEW)");
    expect(body).not.toContain("NEW.period_label");

    const update = sql.slice(sql.indexOf("UPDATE public.tbm_sessions"));
    expect(update).toContain("COALESCE(is_deleted, false)");
    expect(update).toContain("starts_with(COALESCE(title, ''), '__QA__')");
    const rollbackBody = rollback.slice(rollback.indexOf("AS $function$"));
    expect(rollbackBody).not.toContain("is_active");
    expect(readdirSync("supabase/migrations").some((name) => name.includes("qa_tbm_inactive"))).toBe(false);
  });
});
