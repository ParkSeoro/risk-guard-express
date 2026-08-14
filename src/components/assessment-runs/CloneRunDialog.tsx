import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cloneAssessmentRun } from '@/lib/cloneAssessmentRun';
import { useToast } from '@/hooks/use-toast';
import { useAuditLog } from '@/hooks/useAuditLog';
import { useAuth } from '@/contexts/AuthContext';

interface CloneRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: any;
  onCloned: () => void;
}

const CloneRunDialog = ({ open, onOpenChange, run, onCloned }: CloneRunDialogProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { log } = useAuditLog();
  const { user } = useAuth();
  const [newPeriod, setNewPeriod] = useState('');
  const [cloning, setCloning] = useState(false);

  const handleClone = async () => {
    if (!run || !user) return;
    setCloning(true);
    const result = await cloneAssessmentRun({
      source: run,
      userId: user.id,
      periodLabel: newPeriod,
    });
    if (result.ok === false) {
      toast({ title: '복제 실패', description: result.error, variant: 'destructive' });
      setCloning(false);
      return;
    }

    await log('clone_run', 'assessment_run', result.id, run.project_id, {
      source_run_id: run.id,
      source_period_label: run.period_label,
      cloned_items: result.itemCount,
      cloned_participants: result.participantCount,
    });

    toast({ title: '개정 회차가 생성되었습니다.' });
    setNewPeriod('');
    setCloning(false);
    onOpenChange(false);
    onCloned();
    navigate(`/assessment-run/${result.id}`);
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          import('@/lib/unlockBodyPointerEvents').then(({ unlockBodyPointerEvents }) => {
            unlockBodyPointerEvents();
            window.setTimeout(() => unlockBodyPointerEvents(), 50);
          });
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>개정 회차 생성 (복제)</AlertDialogTitle>
          <AlertDialogDescription>
            "{run?.period_label}" 회차의 위험 항목과 참여자를 복제하여 새로운 회차를 생성합니다.
            상태는 '작성중'으로 설정됩니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 py-2">
          <Label>새 회차 기간명</Label>
          <Input
            value={newPeriod}
            onChange={e => setNewPeriod(e.target.value)}
            placeholder={`${run?.period_label || ''} (개정)`}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <Button onClick={handleClone} disabled={cloning}>
            {cloning ? '복제 중...' : '개정 회차 생성'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default CloneRunDialog;
