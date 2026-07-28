import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  PERMIT_KIND_OPTIONS,
  type PermitKindId,
  togglePermitKind,
} from '@/lib/permitKinds';

interface Props {
  value: PermitKindId[];
  onChange: (next: PermitKindId[]) => void;
  disabled?: boolean;
  className?: string;
}

/** Top-of-form multi-select for which permit sheets belong to this single task. */
export default function PermitKindSelector({ value, onChange, disabled, className }: Props) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-sm font-semibold">필요 허가서 종류</span>
        <Badge variant="outline" className="text-[10px]">{value.length}종 선택</Badge>
        <span className="text-xs text-muted-foreground">선택한 종류만 작성·인쇄·결재 묶음에 포함됩니다</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {PERMIT_KIND_OPTIONS.map((opt) => {
          const checked = value.includes(opt.id);
          return (
            <label
              key={opt.id}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors ${
                checked ? 'border-primary bg-primary/5' : 'border-border bg-background'
              } ${disabled ? 'opacity-60 cursor-not-allowed' : 'hover:bg-muted/40'}`}
            >
              <Checkbox
                checked={checked}
                disabled={disabled}
                onCheckedChange={(v) => onChange(togglePermitKind(value, opt.id, !!v))}
              />
              <Label className="cursor-pointer text-sm font-medium leading-tight">{opt.short}</Label>
            </label>
          );
        })}
      </div>
    </div>
  );
}
