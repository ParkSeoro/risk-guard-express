import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CONSTRUCTION_TYPE_OPTIONS } from '@/lib/constructionTypes';
import type { ConstructionForm } from '@/lib/companyConstruction';
import { ContractOcrButton } from '@/components/ContractOcrButton';

export default function ConstructionFields({
  value,
  onChange,
}: {
  value: ConstructionForm;
  onChange: (next: ConstructionForm) => void;
}) {
  const known = CONSTRUCTION_TYPE_OPTIONS.includes(value.construction_type as (typeof CONSTRUCTION_TYPE_OPTIONS)[number]);
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium">이 현장 공사정보</p>
        <ContractOcrButton
          onDraft={(d) =>
            onChange({
              ...value,
              construction_name: d.work_scope ? String(d.work_scope) : value.construction_name,
              construction_period_start:
                d.start_date && /^\d{4}-\d{2}-\d{2}$/.test(d.start_date)
                  ? d.start_date
                  : value.construction_period_start,
              construction_period_end:
                d.end_date && /^\d{4}-\d{2}-\d{2}$/.test(d.end_date)
                  ? d.end_date
                  : value.construction_period_end,
              construction_amount:
                typeof d.construction_amount === 'number' && d.construction_amount > 0
                  ? String(d.construction_amount)
                  : value.construction_amount,
            })
          }
        />
      </div>
      <p className="text-[10px] text-muted-foreground">금액과 기간은 이 현장에만 저장됩니다. 비워 두면 연결만 되고 목록에 공사정보 없음이 남습니다.</p>
      <div className="space-y-1">
        <Label className="text-xs">공사명</Label>
        <Input value={value.construction_name} onChange={(e) => onChange({ ...value, construction_name: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">공종</Label>
        <Select
          value={value.construction_type || '__none__'}
          onValueChange={(v) => onChange({ ...value, construction_type: v === '__none__' ? '' : v })}
        >
          <SelectTrigger><SelectValue placeholder="공종 선택" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">선택 안 함</SelectItem>
            {!known && value.construction_type ? (
              <SelectItem value={value.construction_type}>{value.construction_type}</SelectItem>
            ) : null}
            {CONSTRUCTION_TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">착공일</Label>
          <Input type="date" value={value.construction_period_start} onChange={(e) => onChange({ ...value, construction_period_start: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">준공일</Label>
          <Input type="date" value={value.construction_period_end} onChange={(e) => onChange({ ...value, construction_period_end: e.target.value })} />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">도급금액(원)</Label>
        <Input
          type="number"
          min={0}
          value={value.construction_amount}
          onChange={(e) => onChange({ ...value, construction_amount: e.target.value })}
        />
      </div>
    </div>
  );
}
