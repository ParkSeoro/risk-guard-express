import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  authorPickerLoadState,
  formatAssessmentAuthorLabel,
  type AssessmentAuthorCandidate,
} from '@/lib/assessmentAuthor';
import { fetchAssessmentAuthorCandidates } from '@/lib/assessmentAuthorQuery';

type Props = {
  projectId: string | null;
  value: string;
  onChange: (userId: string) => void;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  /** Set to restrict the list to these companies. null/omit = project-wide (위험성평가). [] = none. */
  companyIds?: string[] | null;
  /** Access/company scope is still resolving — keep showing 불러오는 중, do not treat [] as final. */
  companyFilterPending?: boolean;
};

export default function AssessmentAuthorPicker({
  projectId,
  value,
  onChange,
  disabled,
  required,
  error,
  companyIds,
  companyFilterPending,
}: Props) {
  const [candidates, setCandidates] = useState<AssessmentAuthorCandidate[]>([]);
  const [loading, setLoading] = useState(() => authorPickerLoadState({
    projectId,
    companyIds,
    companyFilterPending,
  }) !== 'idle');
  const companyKey = companyIds == null ? '*' : companyIds.join(',');

  useEffect(() => {
    let alive = true;
    const state = authorPickerLoadState({ projectId, companyIds, companyFilterPending });

    if (state === 'idle' || state === 'empty') {
      setCandidates([]);
      setLoading(false);
      return () => { alive = false; };
    }
    if (state === 'pending') {
      setLoading(true);
      return () => { alive = false; };
    }

    setLoading(true);
    void fetchAssessmentAuthorCandidates(projectId as string, companyIds)
      .then((next) => {
        if (alive) setCandidates(next);
      })
      .catch(() => {
        if (alive) setCandidates([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => { alive = false; };
    // companyKey is the stable identity of companyIds (null → '*', else join).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, companyKey, companyFilterPending]);

  const selected = candidates.find((c) => c.user_id === value);
  const placeholder = loading
    ? '불러오는 중...'
    : candidates.length
      ? '관리감독자를 선택하세요'
      : '등록된 관리감독자가 없습니다';

  return (
    <div className="space-y-1">
      <Label className="text-xs">작성 주체 (관리감독자){required ? ' *' : ''}</Label>
      <Select value={value || undefined} onValueChange={onChange} disabled={disabled || loading || !projectId}>
        <SelectTrigger className="h-9">
          <SelectValue placeholder={placeholder}>
            {selected ? formatAssessmentAuthorLabel(selected) : undefined}
          </SelectValue>
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
