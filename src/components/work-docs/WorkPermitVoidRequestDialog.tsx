import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { voidRequestErrorMessage } from '@/lib/permitVoidRequest';

export function WorkPermitVoidRequestDialog({
  open,
  onOpenChange,
  permitId,
  onRequested,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  permitId: string;
  onRequested: () => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const close = (v: boolean) => {
    if (busy) return;
    onOpenChange(v);
    if (!v) setReason('');
  };

  const submit = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      toast({ title: '취소 사유를 입력하세요.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await (supabase as any).rpc('request_work_permit_void', {
        _permit_id: permitId,
        _reason: trimmed,
      });
      const code = (data as any)?.error || error?.message || '';
      if (code) {
        toast({
          title: '작업취소 요청 실패',
          description: voidRequestErrorMessage(String(code)),
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: '작업취소 요청을 올렸습니다.',
        description: '발주처 승인 전까지 허가서와 TBM은 그대로입니다.',
      });
      setReason('');
      onOpenChange(false);
      onRequested();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>작업취소 요청</DialogTitle>
          <DialogDescription>
            사유를 올리면 발주처 SM(없으면 CM) 결재가 시작됩니다. 승인 전에는 발행 상태가 유지됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="void-request-reason">취소 사유</Label>
          <Textarea
            id="void-request-reason"
            rows={4}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="취소 사유를 입력하세요"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>닫기</Button>
          <Button variant="destructive" onClick={submit} disabled={busy || !reason.trim()}>
            {busy ? '요청 중…' : '작업취소 요청'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
