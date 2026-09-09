import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void | Promise<void>;
  title?: string;
  description?: string;
  confirmLabel?: string;
};

/**
 * Multi-line reject reason for every electronic-approval surface.
 * Replaces window.prompt so reviewers can write several lines.
 */
export default function ApprovalRejectReasonDialog({
  open,
  onOpenChange,
  onConfirm,
  title = "반려 사유",
  description = "작성자가 보완할 수 있도록 사유를 입력하세요. 여러 줄로 적을 수 있으며, 알림과 문서에 그대로 보입니다.",
  confirmLabel = "반려",
}: Props) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setReason("");
      setBusy(false);
    }
  }, [open]);

  const submit = async () => {
    const trimmed = reason.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onConfirm(trimmed);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="approval-reject-reason-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{description}</p>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="반려 사유를 입력하세요"
          rows={6}
          className="min-h-[8rem] resize-y text-sm"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            취소
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void submit()}
            disabled={busy || !reason.trim()}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
