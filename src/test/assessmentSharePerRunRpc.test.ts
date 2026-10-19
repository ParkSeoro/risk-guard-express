import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("assessment share pending RPC is per run", () => {
  const sql = readFileSync(
    resolve(__dirname, "../../supabase/migrations/20261019230500_assessment_share_per_run.sql"),
    "utf8",
  );

  it("checks share_acks only on the current run_id", () => {
    expect(sql).toContain("WHERE a.run_id = ar.id");
    expect(sql).not.toMatch(/JOIN public\.assessment_runs sibling/i);
    expect(sql).not.toMatch(/PARTITION BY e\.e_project_id,\s*e\.e_type,\s*e\.e_start_date/i);
  });
});
