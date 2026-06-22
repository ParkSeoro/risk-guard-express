/**
 * useSoftDelete — 표준화된 소프트 삭제 훅.
 *
 * 한 줄로:
 *   1) 사유 입력 prompt
 *   2) is_deleted/deleted_at/by/reason 업데이트
 *   3) audit_logs 자동 기록
 *   4) toast 피드백
 *
 * @example
 *   const { softDelete, restore } = useSoftDelete();
 *   await softDelete('work_plans', planId, { projectId, label: '작업계획서' });
 */
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useAuditLog } from '@/hooks/useAuditLog';
import { useToast } from '@/hooks/use-toast';
import {
  softDeletePayload,
  softRestorePayload,
  type SoftDeleteTable,
  TABLE_LABELS,
} from '@/lib/dataAccess';

interface DeleteOptions {
  projectId?: string | null;
  /** 사용자에게 보여줄 항목명 (예: "작업계획서 #12") */
  label?: string;
  /** 사유 prompt 를 띄울지 (기본 true) */
  promptReason?: boolean;
  /** prompt 없이 바로 삭제할 때 사유 */
  reason?: string;
}

export function useSoftDelete() {
  const { user, profile } = useAuth();
  const { log } = useAuditLog();
  const { toast } = useToast();

  const softDelete = async (
    table: SoftDeleteTable,
    id: string,
    opts: DeleteOptions = {},
  ): Promise<{ ok: boolean; reason?: string; error?: string }> => {
    if (!user) {
      toast({ title: '로그인이 필요합니다', variant: 'destructive' });
      return { ok: false, error: 'NOT_AUTHENTICATED' };
    }

    const tableLabel = TABLE_LABELS[table] || table;
    const itemLabel = opts.label || `${tableLabel} 항목`;

    let reason = opts.reason;
    if (opts.promptReason !== false && !reason) {
      // eslint-disable-next-line no-alert
      const input = window.prompt(
        `[${itemLabel}] 삭제 사유를 입력해주세요.\n(휴지통에서 30일간 복구 가능합니다)`,
        '',
      );
      if (input === null) return { ok: false, error: 'CANCELLED' };
      reason = input.trim();
      if (!reason) {
        toast({ title: '삭제 사유는 필수입니다', variant: 'destructive' });
        return { ok: false, error: 'REASON_REQUIRED' };
      }
    }

    const { error } = await (supabase.from(table) as any)
      .update(softDeletePayload(user.id, reason))
      .eq('id', id);

    if (error) {
      // 한국어 에러 번역 (RLS 등)
      const msg = /row-level security|permission/i.test(error.message)
        ? '권한이 없어 삭제할 수 없습니다.'
        : `삭제 실패: ${error.message}`;
      toast({ title: msg, variant: 'destructive' });
      return { ok: false, error: error.message };
    }

    await log('soft_delete', table, id, opts.projectId || undefined, {
      reason,
      label: itemLabel,
      actor: profile?.display_name || user.email,
    });

    toast({
      title: `${itemLabel} 삭제됨`,
      description: '휴지통에서 복구할 수 있습니다.',
    });
    return { ok: true, reason };
  };

  const restore = async (
    table: SoftDeleteTable,
    id: string,
    opts: { projectId?: string | null; label?: string } = {},
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!user) return { ok: false, error: 'NOT_AUTHENTICATED' };

    const { error } = await (supabase.from(table) as any)
      .update(softRestorePayload())
      .eq('id', id);

    if (error) {
      toast({ title: `복구 실패: ${error.message}`, variant: 'destructive' });
      return { ok: false, error: error.message };
    }

    await log('soft_restore', table, id, opts.projectId || undefined, {
      label: opts.label,
      actor: profile?.display_name || user.email,
    });

    toast({ title: `${opts.label || TABLE_LABELS[table]} 복구됨` });
    return { ok: true };
  };

  return { softDelete, restore };
}
