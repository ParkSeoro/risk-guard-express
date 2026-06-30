/**
 * 양식 빌더 — 우측 속성 패널
 * 선택된 섹션/필드의 속성을 폼으로 편집.
 */
import { FormLayout, FormField, FormSection, FieldType, FIELD_TYPE_LABELS } from '@/lib/permitFormTypes';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';

type SelectedRef =
  | { kind: 'section'; sectionId: string }
  | { kind: 'field'; sectionId: string; fieldKey: string }
  | null;

interface Props {
  layout: FormLayout;
  selected: SelectedRef;
  onChange: (l: FormLayout) => void;
}

const SIGNATURE_ROLES: { value: string; label: string }[] = [
  { value: 'contractor_pic', label: '시공사 담당자' },
  { value: 'cm', label: '시공사 관리자' },
  { value: 'safety_pic', label: '안전 담당자' },
  { value: 'sm', label: '안전관리자' },
  { value: 'site_supervisor', label: '공사감독' },
  { value: 'site_director', label: '현장소장' },
];

const AUTO_SOURCES: { value: string; label: string }[] = [
  { value: 'today', label: '오늘 날짜' },
  { value: 'permit_date', label: '허가서 발행일' },
  { value: 'creator_name', label: '작성자 이름' },
  { value: 'creator_company', label: '작성자 시공사' },
  { value: 'project_name', label: '프로젝트명' },
  { value: 'project_owner', label: '발주사' },
];

export default function PropertyPanel({ layout, selected, onChange }: Props) {
  if (!selected) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">양식 헤더</h3>
        <div>
          <Label className="text-xs">제목</Label>
          <Input
            value={layout.header.title}
            onChange={(e) => onChange({ ...layout, header: { ...layout.header, title: e.target.value } })}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">문서번호</Label>
            <Input
              value={layout.header.doc_no || ''}
              onChange={(e) => onChange({ ...layout, header: { ...layout.header, doc_no: e.target.value } })}
            />
          </div>
          <div>
            <Label className="text-xs">개정</Label>
            <Input
              value={layout.header.rev || ''}
              onChange={(e) => onChange({ ...layout, header: { ...layout.header, rev: e.target.value } })}
            />
          </div>
        </div>
        <div>
          <Label className="text-xs">발행기관(승인업체)</Label>
          <Input
            value={layout.header.issuer || ''}
            onChange={(e) => onChange({ ...layout, header: { ...layout.header, issuer: e.target.value } })}
          />
        </div>
        <p className="text-[11px] text-muted-foreground pt-2">
          좌측에서 섹션이나 필드를 선택하면 속성을 편집할 수 있습니다.
        </p>
      </div>
    );
  }

  const section = layout.sections.find((s) => s.id === selected.sectionId);
  if (!section) return <div className="text-sm text-muted-foreground">선택된 항목을 찾을 수 없습니다.</div>;

  const updateSection = (patch: Partial<FormSection>) => {
    onChange({
      ...layout,
      sections: layout.sections.map((s) => (s.id === section.id ? { ...s, ...patch } : s)),
    });
  };

  if (selected.kind === 'section') {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">섹션 속성</h3>
        <div>
          <Label className="text-xs">제목</Label>
          <Input value={section.title} onChange={(e) => updateSection({ title: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">설명 (선택)</Label>
          <Textarea
            value={section.description || ''}
            rows={2}
            onChange={(e) => updateSection({ description: e.target.value })}
          />
        </div>
        <div className="text-[11px] text-muted-foreground">필드 {section.fields.length}개</div>
      </div>
    );
  }

  // field
  const field = section.fields.find((f) => f.key === selected.fieldKey);
  if (!field) return <div className="text-sm text-muted-foreground">선택된 필드를 찾을 수 없습니다.</div>;

  const updateField = (patch: Partial<FormField>) => {
    updateSection({
      fields: section.fields.map((f) => (f.key === field.key ? { ...f, ...patch } : f)),
    });
  };

  const updateOption = (idx: number, patch: Partial<{ value: string; label: string }>) => {
    const opts = (field.options || []).map((o, i) => (i === idx ? { ...o, ...patch } : o));
    updateField({ options: opts });
  };
  const addOption = () => updateField({ options: [...(field.options || []), { value: `opt${Date.now().toString(36)}`, label: '새 항목' }] });
  const removeOption = (idx: number) => updateField({ options: (field.options || []).filter((_, i) => i !== idx) });

  const updateColumn = (idx: number, patch: Partial<{ key: string; label: string; type?: 'text' | 'number' }>) => {
    const cols = (field.columns || []).map((c, i) => (i === idx ? { ...c, ...patch } : c));
    updateField({ columns: cols });
  };
  const addColumn = () => updateField({ columns: [...(field.columns || []), { key: `c${Date.now().toString(36)}`, label: '새 열', type: 'text' }] });
  const removeColumn = (idx: number) => updateField({ columns: (field.columns || []).filter((_, i) => i !== idx) });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">필드 속성</h3>
        <span className="text-[10px] text-muted-foreground">{FIELD_TYPE_LABELS[field.type]}</span>
      </div>
      <div>
        <Label className="text-xs">라벨</Label>
        <Input value={field.label} onChange={(e) => updateField({ label: e.target.value })} />
      </div>
      <div>
        <Label className="text-xs">키 (영문, 데이터 저장에 사용)</Label>
        <Input
          value={field.key}
          onChange={(e) => {
            const next = e.target.value.replace(/[^a-zA-Z0-9_.]/g, '_');
            updateField({ key: next });
          }}
          className="font-mono text-xs"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">타입</Label>
          <Select value={field.type} onValueChange={(v) => updateField({ type: v as FieldType })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map((t) => (
                <SelectItem key={t} value={t}>{FIELD_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">폭</Label>
          <Select value={String(field.width || 2)} onValueChange={(v) => updateField({ width: Number(v) as 1 | 2 | 3 | 4 })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1/4 (좁게)</SelectItem>
              <SelectItem value="2">1/2 (기본)</SelectItem>
              <SelectItem value="3">3/4</SelectItem>
              <SelectItem value="4">1/1 (전체)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={!!field.required} onCheckedChange={(v) => updateField({ required: v })} />
        필수 입력
      </label>
      {(field.type === 'text' || field.type === 'textarea' || field.type === 'number') && (
        <div>
          <Label className="text-xs">플레이스홀더</Label>
          <Input value={field.placeholder || ''} onChange={(e) => updateField({ placeholder: e.target.value })} />
        </div>
      )}
      {field.type === 'textarea' && (
        <div>
          <Label className="text-xs">줄 수</Label>
          <Input
            type="number"
            min={1}
            max={20}
            value={field.rows || 3}
            onChange={(e) => updateField({ rows: Math.max(1, Number(e.target.value)) })}
          />
        </div>
      )}
      {field.type === 'signature' && (
        <div>
          <Label className="text-xs">서명 역할 (결재 자동매핑)</Label>
          <Select value={field.signatureRole || 'contractor_pic'} onValueChange={(v) => updateField({ signatureRole: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {SIGNATURE_ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      {field.type === 'auto' && (
        <div>
          <Label className="text-xs">자동값 소스</Label>
          <Select value={field.autoSource || 'today'} onValueChange={(v) => updateField({ autoSource: v as any })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {AUTO_SOURCES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      {(field.type === 'select' || field.type === 'radio' || field.type === 'checkbox_group') && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label className="text-xs">선택 항목</Label>
            <Button size="sm" variant="outline" className="h-6 px-2" onClick={addOption}>
              <Plus className="h-3 w-3 mr-1" />추가
            </Button>
          </div>
          <div className="space-y-1">
            {(field.options || []).map((o, i) => (
              <div key={i} className="flex gap-1">
                <Input
                  className="h-7 text-xs font-mono"
                  placeholder="값"
                  value={o.value}
                  onChange={(e) => updateOption(i, { value: e.target.value })}
                />
                <Input
                  className="h-7 text-xs"
                  placeholder="표시 라벨"
                  value={o.label}
                  onChange={(e) => updateOption(i, { label: e.target.value })}
                />
                <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => removeOption(i)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
      {field.type === 'table' && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label className="text-xs">열 정의</Label>
            <Button size="sm" variant="outline" className="h-6 px-2" onClick={addColumn}>
              <Plus className="h-3 w-3 mr-1" />열 추가
            </Button>
          </div>
          <div className="space-y-1">
            {(field.columns || []).map((c, i) => (
              <div key={i} className="flex gap-1">
                <Input className="h-7 text-xs font-mono" placeholder="키" value={c.key} onChange={(e) => updateColumn(i, { key: e.target.value })} />
                <Input className="h-7 text-xs" placeholder="라벨" value={c.label} onChange={(e) => updateColumn(i, { label: e.target.value })} />
                <Select value={c.type || 'text'} onValueChange={(v) => updateColumn(i, { type: v as 'text' | 'number' })}>
                  <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">텍스트</SelectItem>
                    <SelectItem value="number">숫자</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => removeColumn(i)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <Label className="text-xs">도움말 (선택)</Label>
        <Textarea value={field.hint || ''} rows={2} onChange={(e) => updateField({ hint: e.target.value })} />
      </div>
    </div>
  );
}
