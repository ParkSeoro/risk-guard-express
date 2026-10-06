import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  formatPreviousRunOptionLabel,
  type WeeklyLinkRun,
} from '@/lib/weeklyAssessmentLink';

export const AUTO_PREVIOUS_VALUE = '__auto__';

type PreviousRunPickerProps = {
  autoRun: WeeklyLinkRun | null;
  selectedId: string | null | undefined;
  candidates: WeeklyLinkRun[];
  managedCounts: Record<string, number>;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export default function PreviousRunPicker({
  autoRun,
  selectedId,
  candidates,
  managedCounts,
  onChange,
  disabled,
}: PreviousRunPickerProps) {
  const manual = !!(selectedId && selectedId !== autoRun?.id);
  const value = selectedId || AUTO_PREVIOUS_VALUE;
  const autoLabel = autoRun
    ? `자동 · ${formatPreviousRunOptionLabel(autoRun, managedCounts[autoRun.id])}`
    : '자동 · 이 회사의 이전 승인 회차 없음';
  const missingSelected = !!(selectedId && !candidates.some((c) => c.id === selectedId));

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <Label className="text-xs">전회차 (금주 이행 · 관리대상)</Label>
        {manual ? (
          <Badge variant="outline" className="text-[9px]">수동 지정</Badge>
        ) : autoRun ? (
          <Badge variant="outline" className="text-[9px]">자동</Badge>
        ) : (
          <Badge variant="outline" className="text-[9px] text-destructive">미연결</Badge>
        )}
      </div>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="전회차를 선택하세요" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO_PREVIOUS_VALUE} className="text-xs">{autoLabel}</SelectItem>
          {missingSelected && selectedId && (
            <SelectItem value={selectedId} className="text-xs">연결된 전회차</SelectItem>
          )}
          {candidates.map((c) => (
            <SelectItem key={c.id} value={c.id} className="text-xs">
              {formatPreviousRunOptionLabel(c, managedCounts[c.id])}
              {autoRun?.id === c.id ? ' (자동 후보)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[10px] text-muted-foreground">
        이 문서와 같은 회사의 승인완료 회차만 자동으로 붙습니다. 그 회사의 이전 회차가 없으면 목록도 비어 있습니다.
      </p>
    </div>
  );
}
