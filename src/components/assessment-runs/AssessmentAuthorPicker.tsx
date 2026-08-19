import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ASSESSMENT_LEGAL_AUTHOR_LABEL,
  buildAuthorCandidates,
  formatAssessmentAuthorLabel,
  type AssessmentAuthorCandidate,
} from '@/lib/assessmentAuthor';

type Props = {
  projectId: string | null;
  value: string;
  onChange: (userId: string) => void;
  disabled?: boolean;
  required?: boolean;
  error?: string;
};

export default function AssessmentAuthorPicker({
  projectId,
  value,
  onChange,
  disabled,
  required,
  error,
}: Props) {
  const [candidates, setCandidates] = useState<AssessmentAuthorCandidate[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      // role/position 둘 다 봄. enum .in() 누락 방지용으로 역할별 조회.
      const [byRoleSup, byRoleMgr, byPosSup, byPosMgr] = await Promise.all([
        supabase.from('project_members').select('user_id, company_id, role_new, position_new').eq('project_id', projectId).eq('role_new', 'site_supervisor'),
        supabase.from('project_members').select('user_id, company_id, role_new, position_new').eq('project_id', projectId).eq('role_new', 'site_manager'),
        supabase.from('project_members').select('user_id, company_id, role_new, position_new').eq('project_id', projectId).eq('position_new', 'SITE_SUPERVISOR'),
        supabase.from('project_members').select('user_id, company_id, role_new, position_new').eq('project_id', projectId).eq('position_new', 'SITE_MANAGER'),
      ]);
      const rows = [
        ...(byRoleSup.data || []),
        ...(byRoleMgr.data || []),
        ...(byPosSup.data || []),
        ...(byPosMgr.data || []),
      ];
      const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
      const companyIds = [...new Set(rows.map((r) => r.company_id).filter(Boolean))] as string[];
      const [{ data: profiles }, { data: companies }] = await Promise.all([
        userIds.length
          ? supabase.from('profiles').select('user_id, display_name').in('user_id', userIds)
          : Promise.resolve({ data: [] as { user_id: string; display_name: string | null }[] }),
        companyIds.length
          ? supabase.from('companies').select('id, name').in('id', companyIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ]);
      if (cancelled) return;
      const nameByUser = new Map((profiles || []).map((p) => [p.user_id, p.display_name || '']));
      const nameByCo = new Map((companies || []).map((c) => [c.id, c.name]));
      setCandidates(buildAuthorCandidates(rows.map((row) => ({
        user_id: row.user_id,
        company_id: row.company_id,
        role_new: row.role_new,
        position_new: row.position_new,
        display_name: nameByUser.get(row.user_id) || '',
        company_name: row.company_id ? (nameByCo.get(row.company_id) || '') : '',
      }))));
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const directors = candidates.filter((c) => c.role === 'site_manager');
  const supervisors = candidates.filter((c) => c.role !== 'site_manager');

  return (
    <div className="space-y-1">
      <Label className="text-xs">작성 주체 ({ASSESSMENT_LEGAL_AUTHOR_LABEL}){required ? ' *' : ''}</Label>
      <Select value={value || undefined} onValueChange={onChange} disabled={disabled || loading || !projectId}>
        <SelectTrigger className="h-9">
          <SelectValue placeholder={loading ? '불러오는 중...' : candidates.length ? `${ASSESSMENT_LEGAL_AUTHOR_LABEL}를 선택하세요` : `등록된 ${ASSESSMENT_LEGAL_AUTHOR_LABEL}가 없습니다`} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {directors.length > 0 && (
            <>
              <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">현장소장</div>
              {directors.map((c) => (
                <SelectItem key={c.user_id} value={c.user_id}>
                  {formatAssessmentAuthorLabel(c)}
                </SelectItem>
              ))}
            </>
          )}
          {supervisors.length > 0 && (
            <>
              <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">관리감독자</div>
              {supervisors.map((c) => (
                <SelectItem key={c.user_id} value={c.user_id}>
                  {formatAssessmentAuthorLabel(c)}
                </SelectItem>
              ))}
            </>
          )}
        </SelectContent>
      </Select>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!error && candidates.length === 0 && !loading && projectId && (
        <p className="text-[10px] text-muted-foreground">프로젝트에 {ASSESSMENT_LEGAL_AUTHOR_LABEL}를 먼저 등록하세요. 안전관리자는 작성 주체가 될 수 없습니다.</p>
      )}
    </div>
  );
}
