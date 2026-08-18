import { describe, expect, it } from "vitest";
import {
  approvalActionSuccessMessage,
  approvalRejectNotifyMessage,
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
