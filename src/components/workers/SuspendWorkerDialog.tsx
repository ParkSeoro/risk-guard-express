import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2 } from "lucide-react";
import { SUSPENSION_OPTIONS, type SuspensionKind } from "@/lib/workerSuspension";
import { usePreviewWriteBlock } from "@/contexts/PreviewContext";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  worker: { id: string; name: string } | null;
  onDone?: () => void;
};

export default function SuspendWorkerDialog({ open, onOpenChange, worker, onDone }: Props) {
  const [kind, setKind] = useState<SuspensionKind>("1d");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const blockWrite = usePreviewWriteBlock();

  const submit = async () => {
    if (!worker) return;
    if (blockWrite()) {
      toast.message("프리뷰 모드에서는 데이터를 변경할 수 없습니다.");
      return;
    }
    if (reason.trim().length < 2) {
      toast.error("정지 사유를 입력하세요.");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("set_worker_site_entry_suspension" as any, {
        _worker_id: worker.id,
        _kind: kind,
        _reason: reason.trim(),
      });
      if (error) throw error;
      const j = data as any;
      if (j?.error) throw new Error(j.error);
      toast.success(`${worker.name} 출입 정지 적용`);
      onOpenChange(false);
      setReason("");
      onDone?.();
    } catch (e: any) {
      toast.error(e?.message || "정지 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>현장 출입 정지</DialogTitle>
          <DialogDescription>
            {worker?.name || "근로자"}의 현장 출근·QR 출입을 정지합니다. 사유는 필수입니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label>정지 기간</Label>
            <RadioGroup value={kind} onValueChange={(v) => setKind(v as SuspensionKind)} className="gap-2">
              {SUSPENSION_OPTIONS.map((o) => (
                <div key={o.kind} className="flex items-center space-x-2">
                  <RadioGroupItem value={o.kind} id={`susp-${o.kind}`} />
                  <Label htmlFor={`susp-${o.kind}`} className="font-normal cursor-pointer">
                    {o.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
          <div className="space-y-2">
            <Label htmlFor="susp-reason">사유</Label>
            <Textarea
              id="susp-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="예: 안전수칙 위반, 교육 미이수 등"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            취소
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            정지 적용
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
