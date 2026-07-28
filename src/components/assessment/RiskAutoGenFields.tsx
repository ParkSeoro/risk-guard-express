import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { X } from 'lucide-react';

/** Unified work-condition chips (replaces 작업환경 + 환경 태그) */
export const DEFAULT_CONDITION_TAGS = [
  '고소', '밀폐', '화기', '야간', '굴착', '양중', '전기',
  '분진', '소음', '고온', '저온', '습기', '협소', '해상', '화학', '진동', '유해물질',
];

export const DEFAULT_EQUIPMENT_SUGGESTIONS = [
  '크레인', '타워크레인', '지게차', '고소작업대', '굴착기', '용접기',
  '그라인더', '펌프카', '덤프트럭', '항타기', '천공기', '브레이커', '로더', '롤러',
];

interface ConditionTagsProps {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
}

export function ConditionTagPicker({ value, onChange, suggestions = DEFAULT_CONDITION_TAGS }: ConditionTagsProps) {
  const toggle = (tag: string) => {
    onChange(value.includes(tag) ? value.filter((t) => t !== tag) : [...value, tag]);
  };
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold">작업 조건 태그 <span className="font-normal text-muted-foreground">(다중 선택)</span></Label>
      <div className="flex flex-wrap gap-1.5 rounded-lg border bg-muted/20 p-2">
        {suggestions.map((tag) => {
          const on = value.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              onClick={() => toggle(tag)}
              className={`min-h-9 px-3 rounded-md text-xs font-medium border transition-colors ${
                on
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-foreground border-border hover:bg-muted'
              }`}
            >
              {tag}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface EquipmentTagInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
}

/** Click suggestions or type+Enter/comma to add equipment tags */
export function SmartEquipmentTagInput({
  value,
  onChange,
  suggestions = DEFAULT_EQUIPMENT_SUGGESTIONS,
}: EquipmentTagInputProps) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = draft.trim().toLowerCase();
    const base = suggestions.filter((s) => !value.includes(s));
    if (!q) return base.slice(0, 8);
    return base.filter((s) => s.toLowerCase().includes(q)).slice(0, 8);
  }, [draft, suggestions, value]);

  const add = (raw: string) => {
    const parts = raw.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return;
    const next = [...value];
    for (const p of parts) {
      if (!next.includes(p)) next.push(p);
    }
    onChange(next);
    setDraft('');
    setOpen(false);
  };

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold">사용 장비 <span className="font-normal text-muted-foreground">(태그 클릭 또는 직접 입력)</span></Label>
      <div className="rounded-lg border bg-background p-2 space-y-2">
        {value.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {value.map((tag) => (
              <Badge key={tag} variant="default" className="gap-1 text-[11px] h-7 px-2">
                {tag}
                <button type="button" aria-label={`${tag} 제거`} onClick={() => remove(tag)} className="ml-0.5">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <div className="relative">
          <Input
            className="h-9 text-sm"
            value={draft}
            placeholder="장비명 검색·입력 후 Enter (예: 크레인)"
            onChange={(e) => { setDraft(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                if (draft.trim()) add(draft);
              } else if (e.key === 'Backspace' && !draft && value.length > 0) {
                remove(value[value.length - 1]);
              }
            }}
          />
          {open && filtered.length > 0 && (
            <ul className="absolute z-20 left-0 right-0 mt-1 max-h-40 overflow-y-auto rounded-md border bg-popover shadow-md">
              {filtered.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted min-h-10"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => add(s)}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {suggestions.filter((s) => !value.includes(s)).slice(0, 10).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="min-h-8 px-2.5 rounded-md text-[11px] border border-dashed border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              + {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
