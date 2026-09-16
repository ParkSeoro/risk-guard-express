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
import { voidWorkDocumentErrorMessage } from '@/lib/workDocVoid';

export function WorkDocVoidDialog({
  open,
  onOpenChange,
  entityType,
  entityId,
  onVoided,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: 'work_permit' | 'work_plan';
  entityId: string;
  onVoided: () => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const label = entityType === 'work_plan' ? '작업계획서' : '작업허가서';

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
      const { data, error } = await (supabase as any).rpc('void_work_document', {
        _entity_type: entityType,
        _entity_id: entityId,
        _reason: trimmed,
      });
      const code = (data as any)?.error || error?.message || '';
      if (code) {
        toast({
          title: '작업 취소 실패',
          description: voidWorkDocumentErrorMessage(String(code)),
          variant: 'destructive',
        });
        return;
      }
      toast({ title: `${label}를 작업 취소했습니다.`, description: '문서는 남아 있고 빨간 취소 표시가 찍힙니다.' });
      setReason('');
      onOpenChange(false);
      onVoided();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>작업 취소</DialogTitle>
          <DialogDescription>
            {label}는 삭제되지 않습니다. 빨간 네모칸으로 「작업 취소」가 찍히고,
            근로자 당일·TBM·순찰 오늘 목록에서는 빠집니다. 연결된 다른 문서는 따로 취소해야 합니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="void-reason">취소 사유</Label>
          <Textarea
            id="void-reason"
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
            {busy ? '처리 중…' : '작업 취소'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
