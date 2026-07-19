/**
 * 서명 슬롯 → 역할 매핑 편집기.
 * - AI가 감지한 서명란 리스트를 표로 표시
 * - 각 슬롯의 역할·순서·라벨을 수정 가능
 * - 결재라인 자동 프리셋(순서 = 결재 단계)
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SignatureSlot, SIGNATURE_ROLE_LABELS, SignatureRole } from '@/lib/permitFormTypes';
import { Trash2, ArrowUp, ArrowDown, Plus, Signature } from 'lucide-react';

interface Props {
  slots: SignatureSlot[];
  onChange: (slots: SignatureSlot[]) => void;
}

export default function SignatureSlotMapper({ slots, onChange }: Props) {
  const sorted = [...slots].sort((a, b) => a.order - b.order);

  const update = (id: string, patch: Partial<SignatureSlot>) => {
    onChange(slots.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };
  const remove = (id: string) => onChange(slots.filter((s) => s.id !== id));
  const move = (id: string, dir: -1 | 1) => {
    const idx = sorted.findIndex((s) => s.id === id);
    const target = sorted[idx + dir];
    if (!target) return;
    onChange(slots.map((s) => {
      if (s.id === id) return { ...s, order: target.order };
      if (s.id === target.id) return { ...s, order: sorted[idx].order };
      return s;
    }));
  };
  const add = () => {
    const next: SignatureSlot = {
      id: `sig_${Date.now().toString(36)}`,
      role: 'custom',
      label: '서명',
      page: 1,
      x: 0.1, y: 0.9, w: 0.1, h: 0.05,
      order: sorted.length + 1,
      render_name: true,
      render_date: true,
    };
    onChange([...slots, next]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Signature className="h-4 w-4 text-orange-500" />
          <span className="text-sm font-medium">서명 슬롯 ({slots.length})</span>
          <Badge variant="outline" className="text-[10px]">
            결재 {sorted.length}단계 자동 프리셋
          </Badge>
        </div>
        <Button size="sm" variant="outline" onClick={add}><Plus className="h-3.5 w-3.5 mr-1" />추가</Button>
      </div>

      {slots.length === 0 && (
        <div className="text-xs text-muted-foreground text-center py-6 border-2 border-dashed rounded">
          서명 슬롯이 없습니다. "AI 자동 분석"으로 자동 인식하거나 수동으로 추가하세요.
        </div>
      )}

      <div className="space-y-1.5">
        {sorted.map((s, i) => (
          <div key={s.id} className="border rounded p-2 grid grid-cols-12 gap-2 items-center">
            <div className="col-span-1 flex flex-col gap-0.5">
              <Badge className="bg-orange-500 text-white justify-center">{s.order}</Badge>
              <div className="flex flex-col">
                <button className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30"
                  disabled={i === 0} onClick={() => move(s.id, -1)}>
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30"
                  disabled={i === sorted.length - 1} onClick={() => move(s.id, 1)}>
                  <ArrowDown className="h-3 w-3" />
                </button>
              </div>
            </div>
            <div className="col-span-3">
              <label className="text-[10px] text-muted-foreground">원본 라벨</label>
              <Input value={s.label} onChange={(e) => update(s.id, { label: e.target.value })}
                className="h-7 text-xs" />
            </div>
            <div className="col-span-3">
              <label className="text-[10px] text-muted-foreground">역할 (결재자)</label>
              <Select value={s.role} onValueChange={(v) => update(s.id, { role: v as SignatureRole })}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(SIGNATURE_ROLE_LABELS) as SignatureRole[]).map((r) => (
                    <SelectItem key={r} value={r}>{SIGNATURE_ROLE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 text-[11px] text-muted-foreground">
              페이지 {s.page}<br />
              위치 {(s.x * 100).toFixed(0)},{(s.y * 100).toFixed(0)}
            </div>
            <div className="col-span-2 flex flex-col gap-0.5 text-[11px]">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={!!s.render_name}
                  onChange={(e) => update(s.id, { render_name: e.target.checked })} />
                이름
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={!!s.render_date}
                  onChange={(e) => update(s.id, { render_date: e.target.checked })} />
                일자
              </label>
            </div>
            <div className="col-span-1 text-right">
              <Button size="sm" variant="ghost" className="h-7 px-1 text-destructive" onClick={() => remove(s.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
