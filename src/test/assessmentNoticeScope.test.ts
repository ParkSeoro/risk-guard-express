import { describe, expect, it } from "vitest";
import {
  filterAssessmentNoticesByCompanyScope,
  noticeCompanyIdsForRun,
} from "@/lib/assessmentNoticeScope";

describe("noticeCompanyIdsForRun", () => {
  it("prefers stored then targets then author company", () => {
    expect(noticeCompanyIdsForRun({ company_ids: ["co-a"] })).toEqual(["co-a"]);
    expect(noticeCompanyIdsForRun({ target_company_ids: ["co-b"] })).toEqual(["co-b"]);
    expect(
      noticeCompanyIdsForRun(
        { author_user_id: "u1", target_company_ids: [] },
        { u1: "co-c" },
      ),
    ).toEqual(["co-c"]);
  });
});

describe("filterAssessmentNoticesByCompanyScope", () => {
  const rows = [
    { id: "manual", run_id: null },
    { id: "own", run_id: "r-own" },
    { id: "child", run_id: "r-child" },
    { id: "peer", run_id: "r-peer" },
  ];
  const companyIdsByRunId = {
    "r-own": ["gc-a"],
    "r-child": ["co-1"],
    "r-peer": ["gc-b"],
  };

  it("lets 발주처 see everything", () => {
    expect(
      filterAssessmentNoticesByCompanyScope(rows, {
        accessibleCompanyIds: null,
        companyIdsByRunId,
      }).map((r) => r.id),
    ).toEqual(["manual", "own", "child", "peer"]);
  });

  it("lets 시공사 see own + descendant contractor, not peer GC", () => {
    expect(
      filterAssessmentNoticesByCompanyScope(rows, {
        accessibleCompanyIds: ["gc-a", "co-1"],
        companyIdsByRunId,
      }).map((r) => r.id),
    ).toEqual(["manual", "own", "child"]);
  });

  it("lets 협력사 see own only", () => {
    expect(
      filterAssessmentNoticesByCompanyScope(rows, {
        accessibleCompanyIds: ["co-1"],
        companyIdsByRunId,
      }).map((r) => r.id),
    ).toEqual(["manual", "child"]);
  });

  it("prefers stored notice company_ids over the run map", () => {
    expect(
      filterAssessmentNoticesByCompanyScope(
        [{ id: "stored", run_id: "r-peer", company_ids: ["co-1"] }],
        {
          accessibleCompanyIds: ["co-1"],
          companyIdsByRunId,
        },
      ).map((r) => r.id),
    ).toEqual(["stored"]);
  });
});
