/** Print/PDF block for 통합 결재 comments. Permits do not use this. */

export type ApprovalPrintCommentInput = {
  approver_name?: string | null;
  user_name?: string | null;
  comment?: string | null;
};

export type ApprovalPrintComment = { name: string; comment: string };

export function approvalCommentsForPrint(
  rows: ApprovalPrintCommentInput[] | null | undefined,
): ApprovalPrintComment[] {
  return (rows || [])
    .map((r) => ({
      name: String(r.approver_name || r.user_name || "").trim(),
      comment: String(r.comment || "").trim(),
    }))
    .filter((r) => r.comment.length > 0);
}

export function escapeApprovalPrintHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function approvalCommentsPrintHtml(
  rows: ApprovalPrintCommentInput[] | null | undefined,
  escapeHtml: (s: string) => string = escapeApprovalPrintHtml,
): string {
  const items = approvalCommentsForPrint(rows);
  if (!items.length) return "";
  const lines = items
    .map((i) => {
      const body = escapeHtml(i.comment).replace(/\n/g, "<br/>");
      return `<p class="approval-comment">코멘트 · ${escapeHtml(i.name)}: ${body}</p>`;
    })
    .join("");
  return `<div class="approval-comments">${lines}</div>`;
}

export const APPROVAL_COMMENTS_PRINT_CSS = `
.approval-comments { margin: 0 0 12pt; font-size: 8pt; color: #334155; }
.approval-comment { margin: 2pt 0; white-space: pre-wrap; line-height: 1.4; }
`;
