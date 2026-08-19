/**
 * 당일 승인 작업허가서 위치를 순회 구간 기본값으로 모은다.
 * 법제처 호출 없음.
 */
import { supabase } from '@/integrations/supabase/client';
import { collectTodayPermitRoute, type PermitRouteRow } from '@/lib/legalForms/patrolLog';

export async function fetchTodayPermitRoute(projectId: string): Promise<string> {
  if (!projectId) return '';
  const { data, error } = await supabase
    .from('work_permits' as any)
    .select('location, work_name, work_description, status, is_deleted, permit_date, work_start_at, form_data')
    .eq('project_id', projectId)
    .eq('is_deleted', false)
    .limit(200);
  if (error) return '';
  return collectTodayPermitRoute(((data as PermitRouteRow[]) || []));
}
