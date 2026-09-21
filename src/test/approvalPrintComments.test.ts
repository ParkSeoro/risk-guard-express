import { describe, expect, it } from "vitest";
import {
  approvalCommentsForPrint,
  approvalCommentsPrintHtml,
} from "@/lib/approvalPrintComments";

describe("approvalCommentsForPrint", () => {
  it("keeps 상신 완료 and reviewer comments, drops blanks", () => {
    const rows = approvalCommentsForPrint([
      { approver_name: "박현호", comment: "[상신 완료]" },
      { approver_name: "이철준", comment: "차량 관리 철저" },
      { approver_name: "홍길동", comment: "   " },
      { approver_name: "무의견", comment: null },
    ]);
    expect(rows).toEqual([
      { name: "박현호", comment: "[상신 완료]" },
      { name: "이철준", comment: "차량 관리 철저" },
    ]);
  });

  it("builds the same wording as the 결재함 card", () => {
    const html = approvalCommentsPrintHtml([
      { approver_name: "박현호", comment: "[상신 완료]" },
      { approver_name: "이철준", comment: "차량 관리 철저" },
    ]);
    expect(html).toContain("코멘트 · 박현호: [상신 완료]");
    expect(html).toContain("코멘트 · 이철준: 차량 관리 철저");
  });

  it("escapes HTML in comments", () => {
    const html = approvalCommentsPrintHtml([
      { approver_name: "A", comment: "<script>x</script>" },
    ]);
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("returns empty when nobody left a comment", () => {
    expect(approvalCommentsPrintHtml([{ approver_name: "A", comment: "" }])).toBe("");
    expect(approvalCommentsPrintHtml([])).toBe("");
  });
});
