import { describe, it, expect } from "vitest";
import {
  isPostApprovalStep,
  splitApprovalTimeline,
  currentTimelineSteps,
  approvalStepPosition,
  isStuckClosureSmInbox,
} from "@/lib/permitPostApproval";

const step = (partial: {
  id: string;
  position: string;
  status: string;
  approval_version: number;
  step_order: number;
  comment?: string | null;
  approver_name?: string;
}) => ({
  entity_type: "work_permit",
  ...partial,
});

describe("permitPostApproval timeline split", () => {
  it("classifies closure/extend positions as post-approval", () => {
    expect(isPostApprovalStep("closure_sm")).toBe(true);
    expect(isPostApprovalStep("closure_supervisor")).toBe(true);
    expect(isPostApprovalStep("extend_cm")).toBe(true);
    expect(isPostApprovalStep("extend_sm")).toBe(true);
    expect(isPostApprovalStep("owner_sm")).toBe(false);
    expect(isPostApprovalStep({ step_position: "closure_sm" })).toBe(true);
    expect(approvalStepPosition({ position: null, step_position: "extend_cm" })).toBe("extend_cm");
    expect(approvalStepPosition({ position: null, step_position: "extend_sm" })).toBe("extend_sm");
  });

  it("hides 취소 and separates prior reject from current issuance + post", () => {
    const rows = [
      step({
        id: "v1-sm",
        position: "owner_sm",
        status: "반려",
        approval_version: 1,
        step_order: 5,
        comment: "장비명 기재 누락",
        approver_name: "SM",
      }),
      step({
        id: "v1-cancel",
        position: "owner_cm",
        status: "취소",
        approval_version: 1,
        step_order: 4,
      }),
      step({
        id: "v2-1",
        position: "contractor_supervisor",
        status: "승인",
        approval_version: 2,
        step_order: 1,
      }),
      step({
        id: "v2-2",
        position: "contractor_safety_manager",
        status: "승인",
        approval_version: 2,
        step_order: 2,
      }),
      step({
        id: "v2-3",
        position: "contractor_site_director",
        status: "승인",
        approval_version: 2,
        step_order: 3,
      }),
      step({
        id: "v2-4",
        position: "owner_cm",
        status: "승인",
        approval_version: 2,
        step_order: 4,
      }),
      step({
        id: "v2-5",
        position: "owner_sm",
        status: "승인",
        approval_version: 2,
        step_order: 5,
      }),
      step({
        id: "v3-sup",
        position: "closure_supervisor",
        status: "승인",
        approval_version: 3,
        step_order: 1,
      }),
      step({
        id: "v3-sm",
        position: "closure_sm",
        status: "진행중",
        approval_version: 3,
        step_order: 2,
      }),
    ];

    const split = splitApprovalTimeline(rows);

    expect(split.maxIssuanceVersion).toBe(2);
    expect(split.maxPostVersion).toBe(3);
    expect(split.issuanceSteps.map((s) => s.id)).toEqual([
      "v2-1",
      "v2-2",
      "v2-3",
      "v2-4",
      "v2-5",
    ]);
    expect(split.postSteps.map((s) => s.id)).toEqual(["v3-sup", "v3-sm"]);
    expect(split.priorIssuanceSteps.map((s) => s.id)).toEqual(["v1-sm"]);

    // Reject comment must not appear on current post section
    expect(split.postSteps.some((s) => s.comment === "장비명 기재 누락")).toBe(false);
    expect(split.issuanceSteps.some((s) => s.status === "반려")).toBe(false);
    expect(split.priorIssuanceSteps[0]?.comment).toBe("장비명 기재 누락");

    // 취소 hidden
    expect([...split.issuanceSteps, ...split.postSteps, ...split.priorIssuanceSteps]
      .some((s) => s.status === "취소")).toBe(false);

    const current = currentTimelineSteps(rows);
    expect(current.map((s) => s.id)).toEqual([
      "v2-1",
      "v2-2",
      "v2-3",
      "v2-4",
      "v2-5",
      "v3-sup",
      "v3-sm",
    ]);
    expect(current.some((s) => s.status === "반려")).toBe(false);
  });

  it("legacy same-version closure still splits by position (UI read path)", () => {
    const rows = [
      step({
        id: "iss-sm",
        position: "owner_sm",
        status: "승인",
        approval_version: 2,
        step_order: 5,
      }),
      step({
        id: "close-sm",
        position: "closure_sm",
        status: "진행중",
        approval_version: 2,
        step_order: 7,
      }),
      step({
        id: "old-reject",
        position: "owner_sm",
        status: "반려",
        approval_version: 1,
        step_order: 5,
        comment: "장비명 기재 누락",
      }),
    ];
    const split = splitApprovalTimeline(rows);
    expect(split.issuanceSteps.map((s) => s.id)).toEqual(["iss-sm"]);
    expect(split.postSteps.map((s) => s.id)).toEqual(["close-sm"]);
    expect(split.postSteps[0]?.comment).toBeFalsy();
    expect(split.priorIssuanceSteps[0]?.comment).toBe("장비명 기재 누락");
  });

  it("detects supervisor-approved + SM still 대기 (inbox miss, any contractor)", () => {
    expect(
      isStuckClosureSmInbox([
        { position: "closure_supervisor", status: "승인" },
        { position: "closure_sm", status: "대기" },
      ]),
    ).toBe(true);
    expect(
      isStuckClosureSmInbox([
        { position: "closure_supervisor", status: "승인" },
        { position: "closure_sm", status: "진행중" },
      ]),
    ).toBe(false);
    expect(
      isStuckClosureSmInbox([
        { position: "closure_supervisor", status: "진행중" },
        { position: "closure_sm", status: "대기" },
      ]),
    ).toBe(false);
  });
});
