/**
 * Work plan → TBM 주지(제38조②) 증빙.
 * 정책: 작업계획서는 사전 승인되므로, 근로자 주지는 연결된 TBM 참석으로 본다.
 */
import { supabase } from '@/integrations/supabase/client';

export type WorkPlanNoticeStatus = {
  tbmSessionId: string | null;
  tbmTitle: string | null;
  tbmDate: string | null;
  participantCount: number;
  /** 참석 1명 이상이면 주지 이행으로 간주 */
  notified: boolean;
  label: string;
};

export async function fetchWorkPlanTbmNoticeStatus(
  workPlanId: string,
): Promise<WorkPlanNoticeStatus> {
  const { data: sessions } = await supabase
    .from('tbm_sessions' as any)
    .select('id, title, tbm_date, is_deleted')
    .eq('work_plan_id', workPlanId)
    .eq('is_deleted', false)
    .order('tbm_date', { ascending: false })
    .limit(1);

  const session = ((sessions as any[]) || [])[0];
  if (!session) {
    return {
      tbmSessionId: null,
      tbmTitle: null,
      tbmDate: null,
      participantCount: 0,
      notified: false,
      label: 'TBM 미생성 — 승인된 계획서를 TBM으로 전달·참석받아야 주지 완료',
    };
  }

  const { data: parts, count } = await supabase
    .from('tbm_participations' as any)
    .select('id', { count: 'exact' })
    .eq('tbm_session_id', session.id);

  const participantCount = count ?? ((parts as any[]) || []).length;
  const notified = participantCount > 0;

  return {
    tbmSessionId: session.id,
    tbmTitle: session.title || null,
    tbmDate: session.tbm_date || null,
    participantCount,
    notified,
    label: notified
      ? `주지 이행 — TBM 참석 ${participantCount}명 (${session.tbm_date || '-'})`
      : `TBM 생성됨 · 참석 0명 — 근로자 QR 서명/참석이 필요합니다`,
  };
}
