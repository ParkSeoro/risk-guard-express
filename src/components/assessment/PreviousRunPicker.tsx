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
    : '자동 · 연결할 전회차 없음 (아래에서 고르세요)';
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
        같은 업체·승인완료 회차를 자동으로 붙입니다. 업체가 비어 있거나 종류가 다르면 연결이 빠질 수 있으니 그때는 직접 고르세요.
      </p>
    </div>
  );
}
