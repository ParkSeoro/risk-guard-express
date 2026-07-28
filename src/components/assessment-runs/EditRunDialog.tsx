import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuditLog } from '@/hooks/useAuditLog';
import { useAuth } from '@/contexts/AuthContext';

interface EditRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: any;
  onSaved: () => void;
}

const EditRunDialog = ({ open, onOpenChange, run, onSaved }: EditRunDialogProps) => {
  const { toast } = useToast();
  const { log } = useAuditLog();
  const { user, hasRole } = useAuth();
  const [form, setForm] = useState({
    type: '',
    period_label: '',
    target_processes: '',
    target_contractors: '',
    notes: '',
  });
  const [forceReason, setForceReason] = useState('');
  const isApproved = run?.status === '승인완료';
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (run) {
      setForm({
        type: run.type || '정기',
        period_label: run.period_label || '',
        target_processes: (run.target_processes || []).join(', '),
        target_contractors: (run.target_contractors || []).join(', '),
        notes: run.notes || '',
      });
      setForceReason('');
    }
  }, [run]);

  const handleSave = async () => {
    if (!run) return;
    if (isApproved && !forceReason.trim()) {
      toast({ title: '승인완료 회차는 수정 사유 입력이 필수입니다.', variant: 'destructive' });
      return;
    }
    setSaving(true);

    const updates: any = {
      type: form.type,
      period_label: form.period_label,
      target_processes: form.target_processes.split(',').map(s => s.trim()).filter(Boolean),
      target_contractors: form.target_contractors.split(',').map(s => s.trim()).filter(Boolean),
      notes: form.notes,
    };

    // If approved, reset status to 작성중 for re-approval flow
    if (isApproved) {
      updates.status = '작성중';
    }

    const { error } = await supabase
      .from('assessment_runs')
      .update(updates)
      .eq('id', run.id);

    if (error) {
      toast({ title: '수정 실패', description: error.message, variant: 'destructive' });
      setSaving(false);
      return;
    }

    // Build changed fields for audit
    const changedFields: Record<string, { from: any; to: any }> = {};
    if (run.type !== form.type) changedFields.type = { from: run.type, to: form.type };
    if (run.period_label !== form.period_label) changedFields.period_label = { from: run.period_label, to: form.period_label };
    if (run.notes !== form.notes) changedFields.notes = { from: run.notes, to: form.notes };
    if (isApproved) changedFields.status = { from: '승인완료', to: '작성중' };

    await log(
      isApproved ? 'force_update_run' : 'update_run',
      'assessment_run',
      run.id,
      run.project_id,
      {
        changed_fields: changedFields,
        ...(isApproved ? { force_reason: forceReason } : {}),
      }
    );

    toast({ title: '회차가 수정되었습니다.' });
    setSaving(false);
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog
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
      <DialogContent className="max-w-lg" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>
            회차 수정
            {isApproved && (
              <span className="ml-2 text-xs font-normal text-destructive">
                (승인완료 → 강제 수정: 상태가 '작성중'으로 초기화됩니다)
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>종류 *</Label>
              <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="최초">최초평가</SelectItem>
                  <SelectItem value="정기">정기평가</SelectItem>
                  <SelectItem value="수시">수시평가</SelectItem>
                  <SelectItem value="상시">상시평가</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>적용기간 *</Label>
              <Input
                value={form.period_label}
                onChange={e => setForm(p => ({ ...p, period_label: e.target.value }))}
                placeholder="예: 2026년 3월 1주차"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>대상 공정 (쉼표 구분)</Label>
            <Input
              value={form.target_processes}
              onChange={e => setForm(p => ({ ...p, target_processes: e.target.value }))}
              placeholder="배관, 철골, 용접"
            />
          </div>
          <div className="space-y-1">
            <Label>대상 협력사 (쉼표 구분)</Label>
            <Input
              value={form.target_contractors}
              onChange={e => setForm(p => ({ ...p, target_contractors: e.target.value }))}
              placeholder="(주)대한배관, (주)우리용접"
            />
          </div>
          <div className="space-y-1">
            <Label>비고</Label>
            <Textarea
              value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              placeholder="특이사항, 메모..."
              rows={2}
            />
          </div>
          {isApproved && (
            <div className="space-y-1">
              <Label className="text-destructive">수정 사유 (필수) *</Label>
              <Textarea
                value={forceReason}
                onChange={e => setForceReason(e.target.value)}
                placeholder="승인완료 회차를 수정하는 사유를 입력하세요..."
                rows={2}
              />
            </div>
          )}
          <Button
            onClick={handleSave}
            disabled={!form.period_label || saving || (isApproved && !forceReason.trim())}
            className="w-full"
          >
            {saving ? '저장 중...' : '저장'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EditRunDialog;
