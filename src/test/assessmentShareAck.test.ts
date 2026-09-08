import { describe, expect, it } from "vitest";
import {
  pickCompanyPeriodRuns,
  pickPendingSharePrompts,
  runAppliesToCompany,
  runCoversDate,
  sharePromptGroupKey,
  shareSignatureRowCount,
  shareTypeLabel,
  pairShareAcks,
  isSafeSignatureDataUrl,
  type PendingAssessmentShare,
  type ShareAckRun,
} from "@/lib/assessmentShareAck";

const run = (partial: Partial<ShareAckRun> & { id: string }): ShareAckRun => ({
  project_id: "p1",
  status: "승인완료",
  ...partial,
});

describe("runAppliesToCompany", () => {
  it("does not treat empty targets as the whole site", () => {
    expect(runAppliesToCompany({ target_company_ids: [] }, "co-a")).toBe(false);
    expect(runAppliesToCompany({ target_company_ids: null }, "co-a")).toBe(false);
  });

  it("falls back to the author company when targets are empty", () => {
    expect(runAppliesToCompany({ target_company_ids: [], author_company_id: "co-a" }, "co-a")).toBe(true);
    expect(runAppliesToCompany({ target_company_ids: [], author_company_id: "co-a" }, "co-b")).toBe(false);
  });

  it("matches only listed companies", () => {
    expect(runAppliesToCompany({ target_company_ids: ["co-a"] }, "co-a")).toBe(true);
    expect(runAppliesToCompany({ target_company_ids: ["co-a"] }, "co-b")).toBe(false);
    expect(runAppliesToCompany({ target_company_ids: ["co-a"] }, null)).toBe(false);
  });
});

describe("runCoversDate", () => {
  it("uses inclusive start/end", () => {
    expect(runCoversDate({ start_date: "2026-09-01", end_date: "2026-09-07" }, "2026-09-01")).toBe(true);
    expect(runCoversDate({ start_date: "2026-09-01", end_date: "2026-09-07" }, "2026-09-07")).toBe(true);
    expect(runCoversDate({ start_date: "2026-09-01", end_date: "2026-09-07" }, "2026-08-31")).toBe(false);
    expect(runCoversDate({ start_date: "2026-09-01", end_date: "2026-09-07" }, "2026-09-08")).toBe(false);
  });
});

describe("pickCompanyPeriodRuns", () => {
  const jinnam = "co-jinnam";
  const daewoong = "co-daewoong";
  const week = run({
    id: "week",
    target_company_ids: [jinnam],
    start_date: "2026-09-01",
    end_date: "2026-09-07",
    period_label: "09월 1주차",
    created_at: "2026-08-28T00:00:00Z",
  });
  const otherCo = run({
    id: "other",
    target_company_ids: [daewoong],
    start_date: "2026-09-01",
    end_date: "2026-09-07",
    period_label: "대웅",
    created_at: "2026-08-28T00:00:00Z",
  });
  const prev = run({
    id: "prev",
    target_company_ids: [jinnam],
    start_date: "2026-08-25",
    end_date: "2026-08-31",
    period_label: "08월 4주차",
    created_at: "2026-08-21T00:00:00Z",
  });

  it("returns the covering approved run for that company", () => {
    expect(
      pickCompanyPeriodRuns([week, otherCo, prev], jinnam, "2026-09-03").map((r) => r.id),
    ).toEqual(["week"]);
  });

  it("does not leak another company's run", () => {
    expect(pickCompanyPeriodRuns([week, otherCo], daewoong, "2026-09-03").map((r) => r.id)).toEqual([
      "other",
    ]);
  });

  it("falls back to the latest approved run when today is outside every window", () => {
    expect(
      pickCompanyPeriodRuns([week, prev], jinnam, "2026-09-20").map((r) => r.id),
    ).toEqual(["week"]);
  });

  it("ignores unapproved or deleted runs", () => {
    const draft = run({
      id: "draft",
      status: "작성중",
      target_company_ids: [jinnam],
      start_date: "2026-09-01",
      end_date: "2026-09-07",
    });
    expect(pickCompanyPeriodRuns([draft], jinnam, "2026-09-03")).toEqual([]);
  });
});

describe("pickPendingSharePrompts", () => {
  const share = (
    partial: Partial<PendingAssessmentShare> & { run_id: string },
  ): PendingAssessmentShare => ({
    project_id: "p1",
    period_label: "2026년 9월 2주차",
    type: "상시",
    status: "승인완료",
    start_date: "2026-09-07",
    end_date: "2026-09-13",
    summary: "요지",
    notice_id: null,
    ...partial,
  });

  it("drops future weeks and keeps one copy per week+type", () => {
    const rows = [
      share({ run_id: "week2-old", created_at: undefined, start_date: "2026-09-07" }),
      share({ run_id: "week2-new", period_label: "2026년09월2주차", start_date: "2026-09-07" }),
      share({
        run_id: "week2-occasional",
        type: "수시",
        period_label: "수시위험성평가(2026년 9월 2주차)",
        start_date: "2026-09-07",
      }),
      share({
        run_id: "week3",
        period_label: "2026년 09월 03주차",
        start_date: "2026-09-14",
        end_date: "2026-09-20",
      }),
    ];
    expect(
      pickPendingSharePrompts(rows, { today: "2026-09-07" }).map((r) => r.run_id),
    ).toEqual(["week2-old", "week2-occasional"]);
  });

  it("hides the sibling week after a local dismiss", () => {
    const current = share({ run_id: "signed" });
    const sibling = share({ run_id: "copy", period_label: "2026년09월2주차" });
    expect(
      pickPendingSharePrompts([sibling], {
        today: "2026-09-07",
        dismissedRunIds: [current.run_id],
        dismissedGroupKeys: [sharePromptGroupKey(current)],
      }),
    ).toEqual([]);
  });

  it("labels 상시 and 수시 so the second prompt is not identical", () => {
    expect(shareTypeLabel("상시")).toBe("정기(상시) 위험성평가");
    expect(shareTypeLabel("수시")).toBe("수시 위험성평가");
  });
});

describe("share signature layout", () => {
  it("pairs acks two per row and keeps paper overflow rows", () => {
    expect(pairShareAcks([1, 2, 3])).toEqual([
      [1, 2],
      [3, null],
    ]);
    expect(shareSignatureRowCount(0)).toBe(8);
    expect(shareSignatureRowCount(3)).toBe(8);
    expect(shareSignatureRowCount(20)).toBe(10);
  });

  it("accepts only image data URLs for stamp rendering", () => {
    expect(isSafeSignatureDataUrl("data:image/png;base64,abc+/=")).toBe(true);
    expect(isSafeSignatureDataUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeSignatureDataUrl("https://evil.example/x.png")).toBe(false);
  });
});
