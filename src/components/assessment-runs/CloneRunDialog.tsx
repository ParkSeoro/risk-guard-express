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
import { supabase } from '@/integrations/supabase/client';
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

    // 1. Create new run
    const { data: newRun, error } = await supabase.from('assessment_runs').insert([{
      project_id: run.project_id,
      type: run.type,
      period_label: newPeriod || `${run.period_label} (개정)`,
      target_processes: run.target_processes,
      target_contractors: run.target_contractors,
      notes: run.notes ? `${run.notes}\n\n[원본 회차: ${run.period_label}]` : `[원본 회차: ${run.period_label}]`,
      status: '작성중',
      created_by: user.id,
    }]).select().single();

    if (error || !newRun) {
      toast({ title: '복제 실패', description: error?.message, variant: 'destructive' });
      setCloning(false);
      return;
    }

    // 2. Clone risk_items
    const { data: items } = await supabase
      .from('risk_items')
      .select('*')
      .eq('run_id', run.id);

    if (items && items.length > 0) {
      const clonedItems = items.map(({ id, created_at, updated_at, submitted_at, submitted_by, is_locked, version_number, batch_id, ...rest }) => ({
        ...rest,
        run_id: newRun.id,
        status: '미착수',
        is_locked: false,
        version_number: 1,
        created_by: user.id,
      }));
      await supabase.from('risk_items').insert(clonedItems);
    }

    // 3. Clone participants
    const { data: participants } = await supabase
      .from('assessment_run_participants')
      .select('*')
      .eq('run_id', run.id);

    if (participants && participants.length > 0) {
      const clonedParticipants = participants.map(({ id, created_at, signed_at, ...rest }) => ({
        ...rest,
        run_id: newRun.id,
        signed_at: null,
      }));
      await supabase.from('assessment_run_participants').insert(clonedParticipants);
    }

    await log('clone_run', 'assessment_run', newRun.id, run.project_id, {
      source_run_id: run.id,
      source_period_label: run.period_label,
      cloned_items: items?.length || 0,
      cloned_participants: participants?.length || 0,
    });

    toast({ title: '개정 회차가 생성되었습니다.' });
    setNewPeriod('');
    setCloning(false);
    onOpenChange(false);
    onCloned();
    navigate(`/assessment-run/${newRun.id}`);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
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
