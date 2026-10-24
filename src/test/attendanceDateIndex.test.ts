import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/applied-manually/20261024_attendance_kst_date_indexes.sql",
  "utf8",
);

describe("attendance KST date indexes", () => {
  it("creates non-unique expression indexes outside migrations", () => {
    expect(sql).toContain(
      "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wel_entry_kst_date",
    );
    expect(sql).toContain("((entry_at AT TIME ZONE 'Asia/Seoul')::date)");
    expect(sql).toContain(
      "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tbm_part_kst_date",
    );
    expect(sql).toContain("((participated_at AT TIME ZONE 'Asia/Seoul')::date)");
    expect(sql).not.toMatch(/CREATE UNIQUE INDEX/i);
    const migrationNames = readdirSync("supabase/migrations");
    expect(migrationNames.some((name) => name.includes("kst_date"))).toBe(false);
  });
});
