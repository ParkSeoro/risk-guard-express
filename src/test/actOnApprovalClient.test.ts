import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  approvalActionSuccessMessage,
  approvalRejectNotifyMessage,
  approvalResultNotifyUserIds,
} from "@/lib/actOnApprovalClient";

describe("approvalActionSuccessMessage", () => {
  it("uses 승인/반려 for issuance steps", () => {
    expect(approvalActionSuccessMessage("approve", "normal")).toBe("승인 완료");
    expect(approvalActionSuccessMessage("reject", "normal")).toBe("반려 처리됨");
  });
});

describe("approvalRejectNotifyMessage", () => {
  it("appends the reject comment for the approval line", () => {
    expect(approvalRejectNotifyMessage("배관 용접", "안전모 미착용")).toBe(
      "배관 용접이(가) 반려되었습니다.\n사유: 안전모 미착용",
    );
  });

  it("omits the reason line when comment is empty", () => {
    expect(approvalRejectNotifyMessage("배관 용접", "  ")).toBe(
      "배관 용접이(가) 반려되었습니다.",
    );
  });
});

describe("approvalResultNotifyUserIds", () => {
  const line = [
    { approver_id: "author", status: "승인" },
    { approver_id: "cm", status: "반려" },
    { approver_id: "sm", status: "대기" },
    { approver_id: "owner", status: "대기" },
  ];

  it("does not notify unreached upper steps on reject", () => {
    expect(approvalResultNotifyUserIds({
      eventStatus: "반려",
      actorId: "cm",
      creatorId: "author",
      line,
    }).sort()).toEqual(["author"]);
  });

  it("notifies earlier approvers who already signed, plus the author", () => {
    expect(approvalResultNotifyUserIds({
      eventStatus: "반려",
      actorId: "sm",
      creatorId: "author",
      line: [
        { approver_id: "author", status: "승인" },
        { approver_id: "cm", status: "승인" },
        { approver_id: "sm", status: "반려" },
        { approver_id: "owner", status: "대기" },
      ],
    }).sort()).toEqual(["author", "cm"]);
  });

  it("does not notify the rejector even if they are the author", () => {
    expect(approvalResultNotifyUserIds({
      eventStatus: "반려",
      actorId: "author",
      creatorId: "author",
      line: [
        { approver_id: "author", status: "반려" },
        { approver_id: "cm", status: "대기" },
      ],
    })).toEqual([]);
  });

  it("keeps the full remaining line on final approve", () => {
    expect(approvalResultNotifyUserIds({
      eventStatus: "승인",
      actorId: "owner",
      creatorId: "author",
      line: [
        { approver_id: "author", status: "승인" },
        { approver_id: "cm", status: "승인" },
        { approver_id: "sm", status: "승인" },
        { approver_id: "owner", status: "승인" },
      ],
    }).sort()).toEqual(["author", "cm", "sm"]);
  });
});

describe("trg_approval_notify reject recipients", () => {
  it("filters reject fan-out to already-approved steps in SQL", () => {
    const sql = readFileSync("supabase/migrations/20260828050000_approval_reject_notify_reached.sql", "utf8");
    expect(sql).toMatch(/NEW\.status = '반려' AND a\.status = '승인'/);
    expect(sql).toMatch(/safety_cost_monthly_reports/);
    expect(sql).not.toMatch(/AND COALESCE\(a\.status, ''\) <> '취소'\n\s+UNION/);
  });
});
