import { describe, expect, it } from "vitest";
import { mapHourRpcRow, resolvePledgeText } from "@/lib/laborEvidence";
import { PLEDGE_HASHES } from "@/lib/workHours";
import { WORK_ACK_PLEDGE } from "@/lib/legal/dailyPledges";

describe("mapHourRpcRow", () => {
  it("maps RPC rows onto the workHours engine", () => {
    const row = mapHourRpcRow({
      entry_log_id: "e1",
      worker_id: "w1",
      worker_name: "홍길동",
      entry_at: "2026-09-07T08:00:00+09:00",
      exit_at: "2026-09-07T16:00:00+09:00",
      job_type: "용접공",
      company_name: "A사",
    });
    expect(row.minutes).toBe(480);
    expect(row.manDays).toBe(1);
    expect(row.jobType).toBe("용접공");
    expect(row.workDate).toBe("2026-09-07");
  });
});

describe("resolvePledgeText", () => {
  it("uses the stored hash when it matches a known pledge", () => {
    expect(resolvePledgeText("daily_ack", PLEDGE_HASHES.work)).toBe(WORK_ACK_PLEDGE);
  });
});
