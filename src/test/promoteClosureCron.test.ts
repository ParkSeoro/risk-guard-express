import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/applied-manually/20261024_promote_closure_cron.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/applied-manually/20261024_promote_closure_cron_rollback.sql",
  "utf8",
);

describe("closure promotion cron", () => {
  it("schedules only the promote function twice and can unschedule both jobs", () => {
    expect(sql).toContain("'promote-closure-0905-kst'");
    expect(sql).toContain("'5 0 * * *'");
    expect(sql).toContain("'promote-closure-1105-kst'");
    expect(sql).toContain("'5 2 * * *'");
    const commands = sql.split("$$").filter((_, i) => i % 2 === 1);
    expect(commands).toEqual([
      "SELECT public.promote_permits_to_closure_pending();",
      "SELECT public.promote_permits_to_closure_pending();",
    ]);
    expect(rollback).toContain("cron.unschedule");
    expect(rollback).toContain("promote-closure-0905-kst");
    expect(rollback).toContain("promote-closure-1105-kst");
    expect(rollback).not.toContain("promote_permits_to_closure_pending()");
    expect(
      readdirSync("supabase/migrations").some((name) => name.includes("promote_closure_cron")),
    ).toBe(false);
  });
});
