import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dir = resolve(__dirname, "../../supabase/migrations");

/** Filenames that are not in schema_migrations. A push would run them. */
const unapplied = [
  "20261019021500_owner_sm_signup_approval_notify.sql",
  "20261019230500_assessment_share_per_run.sql",
  "20261022010000_hide_system_test_documents.sql",
  "20261024083000_permit_void_request.sql",
  "20261024104500_block_client_sim_danger_notify.sql",
];

/** Versions already stored in schema_migrations. Push skips these. */
const recorded = [
  "20261019021624_owner_sm_signup_approval_notify.sql",
  "20261019021650_owner_sm_signup_approval_notify_fns.sql",
  "20261019021701_owner_sm_signup_notify_process_push.sql",
  "20261019230659_assessment_share_per_run.sql",
  "20261022005958_hide_system_test_documents.sql",
  "20261022010030_hide_system_test_document_rows.sql",
  "20261022010106_hide_system_test_document_on_insert.sql",
  "20261022010421_skip_qa_assessment_approval_notify.sql",
  "20261023231737_permit_void_request_rpc.sql",
  "20261023231752_permit_void_close_linked_tbm.sql",
  "20261023231839_permit_closure_block_open_void_request.sql",
  "20261023231842_permit_extend_block_open_void_request.sql",
  "20261023232054_permit_void_request_approval_branches.sql",
  "20261024014510_block_client_sim_danger_notify.sql",
];

describe("migration history alignment", () => {
  it("keeps unapplied filenames as SELECT 1 only", () => {
    for (const name of unapplied) {
      const sql = readFileSync(resolve(dir, name), "utf8");
      const executable = sql
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("--"))
        .join("\n");
      expect(executable, name).toBe("SELECT 1;");
      expect(sql, name).not.toMatch(/CREATE|ALTER|DROP|DELETE|UPDATE|INSERT|GRANT|REVOKE/i);
      expect(sql, name).not.toContain("hide_system_test_documents_apply");
      expect(sql, name).not.toContain("NEW.period_label");
    }
  });

  it("records the 14 remote-only versions as files", () => {
    const names = readdirSync(dir);
    for (const name of recorded) {
      expect(names, name).toContain(name);
      expect(readFileSync(resolve(dir, name), "utf8").trim().length).toBeGreaterThan(0);
    }
  });
});
