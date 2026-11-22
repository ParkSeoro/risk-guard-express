import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countOnSite } from "@/lib/dashboardOps";

describe("PR 1-C: Distinct worker attendance / on-site SSOT", () => {
  it("deduplicates duplicate open entries and re-entries per worker_id", () => {
    const res = countOnSite([
      // Worker A checked in twice without exiting -> counts as 1 entry & 1 on-site
      { worker_id: "w-a", entry_at: "2026-11-22T07:00:00+09:00", exit_at: null },
      { worker_id: "w-a", entry_at: "2026-11-22T07:05:00+09:00", exit_at: null },
      // Worker B checked in, exited, then checked back in -> 1 entry & 1 on-site
      { worker_id: "w-b", entry_at: "2026-11-22T07:00:00+09:00", exit_at: "2026-11-22T12:00:00+09:00" },
      { worker_id: "w-b", entry_at: "2026-11-22T13:00:00+09:00", exit_at: null },
      // Worker C checked in and exited -> 1 entry & 0 on-site
      { worker_id: "w-c", entry_at: "2026-11-22T07:10:00+09:00", exit_at: "2026-11-22T17:00:00+09:00" },
    ]);
    expect(res).toEqual({ todayEntries: 3, onSiteWorkers: 2 });
  });

  it("stays backward compatible when worker_id is omitted", () => {
    const res = countOnSite([
      { entry_at: "2026-11-22T07:00:00+09:00", exit_at: null },
      { entry_at: "2026-11-22T07:10:00+09:00", exit_at: "2026-11-22T17:00:00+09:00" },
    ]);
    expect(res).toEqual({ todayEntries: 2, onSiteWorkers: 1 });
  });

  it("scopes WorkerAttendance counts on scopedLogs with countOnSite", () => {
    const src = readFileSync("src/pages/WorkerAttendance.tsx", "utf8").replace(/\r\n/g, "\n");
    expect(src).toContain("const distinct = countOnSite(scopedLogs);");
    expect(src).toContain("all: distinct.todayEntries,");
    expect(src).toContain("inside: distinct.onSiteWorkers,");
  });

  it("excludes TBM-only rows from MobileToday 현재 현장 인원", () => {
    const src = readFileSync("src/pages/MobileToday.tsx", "utf8").replace(/\r\n/g, "\n");
    expect(src).toMatch(
      /\.from\("v_worker_attendance_today" as any\)[\s\S]*?\.not\("entry_at", "is", null\)[\s\S]*?\.eq\("exited", false\)/,
    );
  });

  it("deduplicates open worker_entry_logs per worker_id in both distribution RPCs", () => {
    const sql = readFileSync(
      "supabase/migrations/20261122132500_distribution_distinct_workers.sql",
      "utf8",
    ).replace(/\r\n/g, "\n");
    const distinctMatches = sql.match(/SELECT DISTINCT ON \(e\.worker_id\)/g) || [];
    expect(distinctMatches.length).toBe(2);
  });
});
