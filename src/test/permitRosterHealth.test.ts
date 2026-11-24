import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateWorkerHealthWarnings } from "@/lib/permitRosterHealth";

describe("Work Permit Roster Health Warning Badges & Next-Due Reminder", () => {
  it("flags 유소견, 요관찰, non-benign restrictions, and expired next_checkup_due", () => {
    const severe = evaluateWorkerHealthWarnings(
      {
        health_grade: "유소견D1",
        health_restrictions: "고소작업 제한",
        next_checkup_due: "2026-11-20",
      },
      "2026-11-24",
    );
    expect(severe.map((b) => b.id)).toEqual(["finding", "restriction", "expired"]);
    expect(severe[0].severity).toBe("danger");
    expect(severe[1].label).toContain("고소작업 제한");

    const obs = evaluateWorkerHealthWarnings(
      {
        health_checkup_status: "요관찰C",
        health_restrictions: "정상업무 가능",
        next_checkup_due: "2027-05-01",
      },
      "2026-11-24",
    );
    expect(obs.map((b) => b.id)).toEqual(["observation"]);
    expect(obs[0].severity).toBe("warn");

    const healthy = evaluateWorkerHealthWarnings(
      {
        health_checkup_status: "정상A",
        health_restrictions: "특이사항 없음",
        next_checkup_due: "2027-11-24",
      },
      "2026-11-24",
    );
    expect(healthy).toEqual([]);
  });

  it("includes next_checkup_due renewal scan in health-checkup-reminder cron", () => {
    const src = readFileSync(
      resolve(__dirname, "../../supabase/functions/health-checkup-reminder/index.ts"),
      "utf-8",
    );
    expect(src).toContain("next_checkup_due");
    expect(src).toContain("renewal_due_workers");
  });
});
