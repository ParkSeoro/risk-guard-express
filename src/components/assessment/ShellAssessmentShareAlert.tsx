import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import ResponsiveSignaturePad, {
  type ResponsiveSignaturePadHandle,
} from "@/components/ResponsiveSignaturePad";
import { usePendingAssessmentShares } from "@/hooks/usePendingAssessmentShares";
import { ackAssessmentRunShare } from "@/lib/assessmentShareAck";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";
/**
 * Blocking confirm after RA approval. Signature stamps 근로자 참여 및 공유 서명 once.
 */
export default function ShellAssessmentShareAlert() {
  const { current, reload } = usePendingAssessmentShares();
  const sigRef = useRef<ResponsiveSignaturePadHandle | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!current) return;
    if (!sigRef.current || sigRef.current.isEmpty()) {
      toast.error("손가락으로 서명란에 서명해 주세요");
      return;
    }
    const signatureData = sigRef.current.toDataURL("image/png");
    if (!signatureData || signatureData.length < 80) {
      toast.error("서명이 유효하지 않습니다. 다시 서명해 주세요");
      return;
    }
    setBusy(true);
    try {
      const res = await ackAssessmentRunShare({
        runId: current.run_id,
        signatureData,
        source: "notice",
      });
      if (!res.ok) throw new Error(res.error || "확인 처리에 실패했습니다");
      sigRef.current.clear();
      toast.success(res.already ? "이미 확인된 회차입니다" : "위험성평가 공유 서명이 기록되었습니다");
      await reload();
    } catch (e: any) {
      toast.error(e?.message || "확인 처리에 실패했습니다");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!current}
      onOpenChange={(next) => {
        if (!next) return;
      }}
    >
      <DialogContent
        className="max-w-md max-h-[90vh] overflow-y-auto print:hidden [&>button.absolute]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5" /> 위험성평가 결과 공유
          </DialogTitle>
          <DialogDescription>
            {current?.period_label || "위험성평가"}가 승인되었습니다. 요지를 확인하고 서명해 주세요.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md bg-muted/60 border p-3 text-sm whitespace-pre-wrap max-h-48 overflow-y-auto">
          {current?.summary}
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="font-medium text-xs">확인 서명 *</div>
            <Button type="button" variant="ghost" size="sm" onClick={() => sigRef.current?.clear()}>
              지우기
            </Button>
          </div>
          <div className="border-2 rounded-md bg-background">
            <ResponsiveSignaturePad ref={sigRef} height={140} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            본 위험성평가 내용을 확인하고 숙지하였음을 서명합니다. 서명란(결재선)이 아니라 공유 서명에 표기됩니다.
          </p>
        </div>
        <DialogFooter>
          <Button className="w-full" onClick={() => void submit()} disabled={busy || !current}>
            {busy ? "저장 중…" : "확인 · 서명"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
