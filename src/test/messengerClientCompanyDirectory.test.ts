import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20261105080000_messenger_client_company_directory.sql",
  "utf8",
);

describe("client company messenger directory", () => {
  it("keeps the same-project filter and adds the client-company exception", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.get_chat_contacts");
    expect(sql).toContain("pm.project_id = p_project_id");
    expect(sql).toContain("messenger_shares_client_company(v_my_user_id, pr.user_id)");
    expect(sql).toContain("messenger_shares_client_company(v_my_user_id, v_user_id)");
    expect(sql).toContain("'client', '발주처', 'owner'");
    expect(sql).not.toContain("에어리퀴드");
  });

  it("does not let the client app call the company check directly", () => {
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.messenger_shares_client_company(uuid, uuid) FROM PUBLIC, anon, authenticated",
    );
  });
});
