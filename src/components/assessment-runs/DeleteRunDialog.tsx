import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuditLog } from '@/hooks/useAuditLog';
import { useAuth } from '@/contexts/AuthContext';
import { unlockBodyPointerEvents } from '@/lib/unlockBodyPointerEvents';

interface DeleteRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: any;
  onDeleted: () => void;
}

function scheduleUnlock() {
  window.setTimeout(() => unlockBodyPointerEvents(), 0);
  window.setTimeout(() => unlockBodyPointerEvents(), 50);
}

const DeleteRunDialog = ({ open, onOpenChange, run, onDeleted }: DeleteRunDialogProps) => {
  const { toast } = useToast();
  const { log } = useAuditLog();
  const { user } = useAuth();
  const [reason, setReason] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!run) return;
    setDeleting(true);

    const { error } = await supabase
      .from('assessment_runs')
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_reason: reason.trim() || null,
        deleted_by: user?.id || null,
      })
      .eq('id', run.id);

    if (error) {
      toast({ title: '삭제 실패', description: error.message, variant: 'destructive' });
      setDeleting(false);
      return;
    }

    await log('delete_run', 'assessment_run', run.id, run.project_id, {
      reason,
      previous_status: run.status,
      period_label: run.period_label,
    });

    toast({ title: '회차가 삭제(숨김)되었습니다.' });
    setReason('');
    setDeleting(false);
    onOpenChange(false);
    scheduleUnlock();
    onDeleted();
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) scheduleUnlock();
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          unlockBodyPointerEvents();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>회차 삭제</AlertDialogTitle>
          <AlertDialogDescription>
            삭제하면 목록에서 숨김 처리되며, 관리자(마스터)는 복구할 수 있습니다.
            <br />
            <strong>대상: {run?.period_label || '(기간 미지정)'}</strong>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 py-2">
          <Label>삭제 사유 (선택)</Label>
          <Textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="필요하면 사유를 남겨 두세요..."
            rows={3}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => scheduleUnlock()}>취소</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? '삭제 중...' : '삭제'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteRunDialog;
