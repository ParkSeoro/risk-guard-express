import { useState } from "react";
import { Button } from "@/components/ui/button";
import IMESafeTextarea from "@/components/IMESafeTextarea";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { usePreviewWriteBlock } from "@/contexts/PreviewContext";
import {
  approvalActionSuccessMessage,
  submitApprovalAction,
} from "@/lib/actOnApprovalClient";
import {
  permitPostStepApproveLabel,
  permitPostStepKind,
} from "@/lib/permitPostApproval";
import { isSubmitterApprovalStep } from "@/lib/approvalRules";

export type PendingApprovalRow = {
  approval_id: string;
  entity_type?: string | null;
  entity_id?: string | null;
  project_id?: string | null;
  step_position?: string | null;
  position?: string | null;
  step?: string | null;
  step_label?: string | null;
  step_order?: number | null;
};

export function canActOnPendingApproval(row: PendingApprovalRow | null | undefined): boolean {
  if (!row?.approval_id) return false;
  return !isSubmitterApprovalStep(row);
}

export default function MobileApprovalActions({
  pending,
  onDone,
}: {
  pending: PendingApprovalRow;
  onDone?: () => void;
}) {
  const blockWrite = usePreviewWriteBlock();
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const kind = permitPostStepKind(pending.step_position || pending.position);

  const decide = async (action: "approve" | "reject") => {
    if (blockWrite()) {
      toast.message("프리뷰 모드에서는 데이터를 변경할 수 없습니다.");
      return;
    }
    if (action === "reject" && !comment.trim()) {
      toast.error("반려 사유를 입력하세요");
      return;
    }
    setSubmitting(true);
    try {
      const { kind: doneKind } = await submitApprovalAction({
        approvalId: pending.approval_id,
        action,
        comment,
        entityType: pending.entity_type,
        entityId: pending.entity_id,
        projectId: pending.project_id,
        stepPosition: pending.step_position || pending.position,
      });
      toast.success(approvalActionSuccessMessage(action, doneKind));
      onDone?.();
    } catch (e: any) {
      toast.error(e?.message || "처리 실패");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2 pt-1" data-testid="mobile-approval-actions">
      <IMESafeTextarea
        rows={2}
        placeholder={kind !== "normal" ? "의견 (선택) / 반려 시 필수" : "의견/사유 (반려 시 필수)"}
        defaultValue={comment}
        onCommit={setComment}
      />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="destructive" onClick={() => decide("reject")} disabled={submitting}>
          <XCircle className="h-4 w-4 mr-1" /> 반려
        </Button>
        <Button onClick={() => decide("approve")} disabled={submitting}>
          {submitting
            ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            : <CheckCircle2 className="h-4 w-4 mr-1" />}
          {permitPostStepApproveLabel(kind)}
        </Button>
      </div>
    </div>
  );
}
