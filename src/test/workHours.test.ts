import { describe, expect, it } from "vitest";
import {
  addSeoulDays,
  buildWorkHourRow,
  consecutiveAttendanceDays,
  formatWorkHours,
  hashPledgeText,
  manDaysFromSpan,
  nightMinutes,
  PLEDGE_HASHES,
  pledgeTextByHash,
  rollupWorkHours,
  seoulWeekStart,
  summarizeHours,
  week52Status,
  workMinutes,
} from "@/lib/workHours";
import { WORK_ACK_PLEDGE } from "@/lib/legal/dailyPledges";

describe("workMinutes / manDays", () => {
  it("returns null when checkout is missing", () => {
    expect(workMinutes("2026-09-07T08:00:00+09:00", null)).toBeNull();
    expect(manDaysFromSpan("2026-09-07T08:00:00+09:00", null)).toBeNull();
  });

  it("counts a full 8-hour day as 1.00 공수", () => {
    expect(workMinutes("2026-09-07T08:00:00+09:00", "2026-09-07T16:00:00+09:00")).toBe(480);
    expect(manDaysFromSpan("2026-09-07T08:00:00+09:00", "2026-09-07T16:00:00+09:00")).toBe(1);
  });

  it("floors minutes and keeps a 0.25 floor when both stamps exist", () => {
    expect(workMinutes("2026-09-07T08:00:00+09:00", "2026-09-07T08:10:30+09:00")).toBe(10);
    expect(manDaysFromSpan("2026-09-07T08:00:00+09:00", "2026-09-07T08:10:30+09:00")).toBe(0.25);
  });

  it("formats hours as h:mm", () => {
    expect(formatWorkHours(null)).toBe("—");
    expect(formatWorkHours(75)).toBe("1:15");
    expect(formatWorkHours(480)).toBe("8:00");
  });
});

describe("Seoul week / Sunday", () => {
  it("starts the week on Monday in Seoul", () => {
    expect(seoulWeekStart("2026-09-08")).toBe("2026-09-07"); // Tue → Mon
    expect(seoulWeekStart("2026-09-13")).toBe("2026-09-07"); // Sun → Mon
    expect(seoulWeekStart("2026-09-07")).toBe("2026-09-07");
  });

  it("adds calendar days without UTC drift", () => {
    expect(addSeoulDays("2026-09-07", 1)).toBe("2026-09-08");
    expect(addSeoulDays("2026-09-07", -1)).toBe("2026-09-06");
  });
});

describe("nightMinutes", () => {
  it("is zero for a daytime shift", () => {
    expect(nightMinutes("2026-09-07T08:00:00+09:00", "2026-09-07T17:00:00+09:00")).toBe(0);
  });

  it("counts evening overlap after 22:00", () => {
    expect(nightMinutes("2026-09-07T20:00:00+09:00", "2026-09-07T23:00:00+09:00")).toBe(60);
  });

  it("counts the 22:00–06:00 window across midnight", () => {
    expect(nightMinutes("2026-09-07T23:00:00+09:00", "2026-09-08T07:00:00+09:00")).toBe(420);
  });

  it("is zero when checkout is missing", () => {
    expect(nightMinutes("2026-09-07T23:00:00+09:00", null)).toBe(0);
  });
});

describe("week52Status", () => {
  it("warns at 52h and cautions at 45h", () => {
    expect(week52Status(44 * 60)).toBe("ok");
    expect(week52Status(45 * 60)).toBe("caution");
    expect(week52Status(52 * 60)).toBe("warn");
  });
});

describe("rollup / streak", () => {
  const rows = [
    buildWorkHourRow({
      entryLogId: "a",
      workerId: "w1",
      workerName: "홍길동",
      entryAt: "2026-09-07T08:00:00+09:00",
      exitAt: "2026-09-07T17:00:00+09:00",
      jobType: "용접공",
      companyName: "A사",
    }),
    buildWorkHourRow({
      entryLogId: "b",
      workerId: "w1",
      workerName: "홍길동",
      entryAt: "2026-09-08T08:00:00+09:00",
      exitAt: "2026-09-08T17:00:00+09:00",
      jobType: "용접공",
      companyName: "A사",
    }),
    buildWorkHourRow({
      entryLogId: "c",
      workerId: "w2",
      workerName: "김철수",
      entryAt: "2026-09-08T08:00:00+09:00",
      jobType: "비계공",
      companyName: "B사",
    }),
  ];

  it("groups by job type and excludes incomplete minutes", () => {
    const byJob = rollupWorkHours(rows, "job_type");
    const weld = byJob.find((r) => r.key === "용접공");
    const scaf = byJob.find((r) => r.key === "비계공");
    expect(weld?.minutes).toBe(9 * 60 * 2);
    expect(weld?.workerCount).toBe(1);
    expect(scaf?.minutes).toBe(0);
    expect(scaf?.incompleteCount).toBe(1);
  });

  it("summarizes project totals", () => {
    const s = summarizeHours(rows);
    expect(s.workerCount).toBe(2);
    expect(s.incompleteCount).toBe(1);
    expect(s.minutes).toBe(1080);
  });

  it("counts consecutive attendance days", () => {
    expect(consecutiveAttendanceDays(["2026-09-07", "2026-09-08", "2026-09-10"])).toBe(2);
    expect(consecutiveAttendanceDays(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"])).toBe(4);
  });

  it("flags empty job type as 미분류", () => {
    const row = buildWorkHourRow({
      entryLogId: "d",
      workerId: "w3",
      entryAt: "2026-09-07T08:00:00+09:00",
      exitAt: "2026-09-07T16:00:00+09:00",
      jobType: "  ",
    });
    expect(row.jobType).toBe("미분류");
  });
});

describe("pledge hash", () => {
  it("is stable for the current work-ack text", () => {
    expect(hashPledgeText(WORK_ACK_PLEDGE)).toBe(PLEDGE_HASHES.work);
    expect(pledgeTextByHash(PLEDGE_HASHES.work)).toBe(WORK_ACK_PLEDGE);
    expect(pledgeTextByHash("deadbeef")).toBeNull();
  });
});
