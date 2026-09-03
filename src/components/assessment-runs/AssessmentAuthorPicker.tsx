import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
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
  /** Set to restrict the list to these companies. null/omit = project-wide (위험성평가). [] = none. */
  companyIds?: string[] | null;
};

export default function AssessmentAuthorPicker({
  projectId,
  value,
  onChange,
  disabled,
  required,
  error,
  companyIds,
}: Props) {
  const [candidates, setCandidates] = useState<AssessmentAuthorCandidate[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setCandidates([]);
      return;
    }
    if (companyIds && companyIds.length === 0) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      let query = supabase
        .from('project_members')
        .select('user_id, company_id')
        .eq('project_id', projectId)
        .eq('role_new', 'site_supervisor');
      if (companyIds && companyIds.length > 0) {
        query = query.in('company_id', companyIds);
      }
      const { data: members } = await query;
      const rows = members || [];
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
      const seen = new Set<string>();
      const next: AssessmentAuthorCandidate[] = [];
      for (const row of rows) {
        if (!row.user_id || seen.has(row.user_id)) continue;
        seen.add(row.user_id);
        next.push({
          user_id: row.user_id,
          display_name: nameByUser.get(row.user_id) || row.user_id.slice(0, 8),
          company_id: row.company_id,
          company_name: row.company_id ? (nameByCo.get(row.company_id) || '') : '',
        });
      }
      next.sort((a, b) => a.display_name.localeCompare(b.display_name, 'ko'));
      setCandidates(next);
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId, companyIds?.join(',')]);

  return (
    <div className="space-y-1">
      <Label className="text-xs">작성 주체 (관리감독자){required ? ' *' : ''}</Label>
      <Select value={value || undefined} onValueChange={onChange} disabled={disabled || loading || !projectId}>
        <SelectTrigger className="h-9">
          <SelectValue placeholder={loading ? '불러오는 중...' : candidates.length ? '관리감독자를 선택하세요' : '등록된 관리감독자가 없습니다'} />
        </SelectTrigger>
        <SelectContent>
          {candidates.map((c) => (
            <SelectItem key={c.user_id} value={c.user_id}>
              {formatAssessmentAuthorLabel(c)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!error && candidates.length === 0 && !loading && projectId && (
        <p className="text-[10px] text-muted-foreground">
          {companyIds
            ? '이 업체에 등록된 관리감독자가 없습니다. 다른 회사 명단은 보여 주지 않습니다.'
            : '프로젝트에 관리감독자를 먼저 등록하세요. 안전관리자는 작성 주체가 될 수 없습니다.'}
        </p>
      )}
    </div>
  );
}
