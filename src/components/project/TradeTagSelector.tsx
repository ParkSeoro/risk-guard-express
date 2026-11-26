import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Sparkles, X } from 'lucide-react';
import {
  normalizeTradeTags,
  STANDARD_TRADE_TAGS,
} from '@/lib/projectTradeTags';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  suggestedFromCompanies?: string[];
  disabled?: boolean;
  label?: string;
}

export default function TradeTagSelector({
  value,
  onChange,
  suggestedFromCompanies = [],
  disabled = false,
  label = '공종 태그 (AI 위험성평가·작업계획서 연동)',
}: Props) {
  const [customInput, setCustomInput] = useState('');
  const selected = normalizeTradeTags(value);
  const selectedLower = new Set(selected.map((t) => t.toLowerCase()));

  const toggleTag = (tag: string) => {
    if (disabled) return;
    const key = tag.trim().toLowerCase();
    if (selectedLower.has(key)) {
      onChange(selected.filter((t) => t.toLowerCase() !== key));
    } else {
      onChange([...selected, tag.trim()]);
    }
  };

  const addCustom = () => {
    if (disabled) return;
    const parts = normalizeTradeTags(customInput);
    if (parts.length === 0) return;
    onChange(normalizeTradeTags([...selected, ...parts]));
    setCustomInput('');
  };

  const customSelected = selected.filter(
    (t) => !STANDARD_TRADE_TAGS.some((std) => std.toLowerCase() === t.toLowerCase()),
  );

  return (
    <div className="space-y-2">
      <Label>{label}</Label>

      {/* Standard preset chips */}
      <div className="flex flex-wrap gap-1.5">
        {STANDARD_TRADE_TAGS.map((tag) => {
          const active = selectedLower.has(tag.toLowerCase());
          return (
            <button
              key={tag}
              type="button"
              disabled={disabled}
              onClick={() => toggleTag(tag)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                active
                  ? 'border-primary bg-primary text-primary-foreground font-medium'
                  : 'border-border bg-background hover:bg-muted/60 text-foreground'
              } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {active ? '✓ ' : '+ '}
              {tag}
            </button>
          );
        })}
      </div>

      {/* Auto-suggested from participating companies' construction_type */}
      {!disabled && suggestedFromCompanies.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1.5">
          <span className="text-[11px] text-primary font-medium inline-flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> 참여 업체 공사종류 추천:
          </span>
          {suggestedFromCompanies.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggleTag(s)}
              className="rounded-full border border-primary/30 bg-background px-2 py-0.5 text-[11px] hover:bg-primary/10"
            >
              + {s}
            </button>
          ))}
        </div>
      )}

      {/* Custom added chips */}
      {customSelected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {customSelected.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs gap-1 pl-2.5 pr-1.5 py-0.5">
              {tag}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className="hover:text-destructive"
                  aria-label={`${tag} 제거`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}

      {/* Custom tag input */}
      {!disabled && (
        <div className="flex gap-2">
          <Input
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustom();
              }
            }}
            placeholder="기타 공종 직접 입력 (예: 6000t Tank, Cooling Tower)..."
            className="h-8 text-xs"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1 shrink-0"
            disabled={!customInput.trim()}
            onClick={addCustom}
          >
            <Plus className="h-3 w-3" /> 추가
          </Button>
        </div>
      )}
    </div>
  );
}
