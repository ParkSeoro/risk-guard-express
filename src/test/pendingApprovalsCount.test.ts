import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { asPendingCount } from "@/hooks/usePendingApprovalsCount";

const COUNT_SQL = "supabase/migrations/20260919120000_disk_io_approvals_indexes.sql";
const INBOX_SQL = "supabase/migrations/20260916090000_void_work_documents.sql";

describe("count_my_pending_entity_approvals", () => {
  it("keeps the same pending filters as the inbox RPC", () => {
    const countSrc = readFileSync(COUNT_SQL, "utf8");
    const inboxSrc = readFileSync(INBOX_SQL, "utf8");

    expect(countSrc).toContain("CREATE OR REPLACE FUNCTION public.count_my_pending_entity_approvals()");
    expect(countSrc).toContain("a.status = '진행중'");
    expect(countSrc).toContain("a.entity_type IS NOT NULL");
    expect(countSrc).toContain("account_is_active");
    expect(countSrc).toContain("is_project_admin");
    expect(countSrc).toContain("approval_entity_is_deleted");
    expect(countSrc).toContain("approval_entity_is_voided");
    expect(countSrc).toContain("idx_approvals_status_approver");
    expect(countSrc).toContain("idx_approvals_project_created");

    expect(inboxSrc).toContain("CREATE OR REPLACE FUNCTION public.get_my_pending_entity_approvals()");
    expect(inboxSrc).toContain("a.status='진행중' AND a.entity_type IS NOT NULL");
    expect(inboxSrc).toContain("approval_entity_is_voided");
  });

  it("parses scalar RPC counts only", () => {
    expect(asPendingCount(3)).toBe(3);
    expect(asPendingCount("4")).toBe(4);
    expect(asPendingCount(null)).toBe(0);
    expect(asPendingCount([{ id: 1 }])).toBe(0);
    expect(asPendingCount(-2)).toBe(0);
  });
});
