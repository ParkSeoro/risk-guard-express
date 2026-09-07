import { describe, expect, it } from "vitest";
import {
  pickCompanyPeriodRuns,
  runAppliesToCompany,
  runCoversDate,
  shareSignatureRowCount,
  pairShareAcks,
  isSafeSignatureDataUrl,
  type ShareAckRun,
} from "@/lib/assessmentShareAck";

const run = (partial: Partial<ShareAckRun> & { id: string }): ShareAckRun => ({
  project_id: "p1",
  status: "승인완료",
  ...partial,
});

describe("runAppliesToCompany", () => {
  it("treats empty targets as project-wide", () => {
    expect(runAppliesToCompany({ target_company_ids: [] }, "co-a")).toBe(true);
    expect(runAppliesToCompany({ target_company_ids: null }, "co-a")).toBe(true);
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
