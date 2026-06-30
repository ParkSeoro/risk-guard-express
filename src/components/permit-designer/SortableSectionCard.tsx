/**
 * 양식 빌더 — 섹션 카드 (드래그 정렬 + 필드 그리드 + 필드 추가/선택)
 */
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FormSection, FormField, FieldType, FIELD_TYPE_LABELS, newField } from '@/lib/permitFormTypes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GripVertical, Plus, Trash2, Copy } from 'lucide-react';

type SelectedRef =
  | { kind: 'section'; sectionId: string }
  | { kind: 'field'; sectionId: string; fieldKey: string }
  | null;

interface Props {
  section: FormSection;
  selected: SelectedRef;
  onSelect: (ref: SelectedRef) => void;
  onChange: (s: FormSection) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

const FIELD_TYPES_TO_ADD: FieldType[] = [
  'text', 'textarea', 'number', 'date', 'daterange', 'time',
  'select', 'radio', 'checkbox', 'checkbox_group',
  'table', 'signature', 'attachment', 'auto',
];

export default function SortableSectionCard({ section, selected, onSelect, onChange, onDelete, onDuplicate }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const isSelected = selected?.kind === 'section' && selected.sectionId === section.id;

  const addField = (type: FieldType) => {
    const f = newField(type, section.fields.length);
    onChange({ ...section, fields: [...section.fields, f] });
    onSelect({ kind: 'field', sectionId: section.id, fieldKey: f.key });
  };

  const updateField = (key: string, patch: Partial<FormField>) => {
    onChange({ ...section, fields: section.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) });
  };

  const removeField = (key: string) => {
    onChange({ ...section, fields: section.fields.filter((f) => f.key !== key) });
    if (selected?.kind === 'field' && selected.fieldKey === key) onSelect(null);
  };

  const widthClass = (w?: number) =>
    w === 4 ? 'col-span-12' : w === 3 ? 'col-span-9' : w === 1 ? 'col-span-3' : 'col-span-6';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`border rounded-md bg-card ${isSelected ? 'border-primary ring-1 ring-primary' : 'border-border'}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect({ kind: 'section', sectionId: section.id });
      }}
    >
      <div className="flex items-center gap-2 px-2 py-1.5 border-b bg-muted/40">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab text-muted-foreground hover:text-foreground p-1"
          onClick={(e) => e.stopPropagation()}
          aria-label="drag"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <Input
          value={section.title}
          onChange={(e) => onChange({ ...section, title: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          className="h-7 text-sm font-semibold border-0 bg-transparent focus-visible:ring-0 px-1"
        />
        <Badge variant="outline" className="text-[10px]">{section.fields.length}개 필드</Badge>
        <div className="ml-auto flex gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={(e) => e.stopPropagation()}>
                <Plus className="h-3.5 w-3.5 mr-1" />필드
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 overflow-auto">
              {FIELD_TYPES_TO_ADD.map((t) => (
                <DropdownMenuItem key={t} onClick={() => addField(t)}>
                  {FIELD_TYPE_LABELS[t]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={(e) => { e.stopPropagation(); onDuplicate(); }}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {section.fields.length === 0 ? (
        <div className="text-xs text-muted-foreground p-4 text-center">
          오른쪽 위 <strong>필드</strong> 버튼으로 필드를 추가하세요.
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-2 p-2">
          {section.fields.map((f) => {
            const isFieldSelected = selected?.kind === 'field' && selected.fieldKey === f.key;
            return (
              <div
                key={f.key}
                className={`${widthClass(f.width)} border rounded px-2 py-1.5 cursor-pointer hover:bg-accent/40 ${
                  isFieldSelected ? 'border-primary bg-accent/40 ring-1 ring-primary' : 'border-border bg-background'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect({ kind: 'field', sectionId: section.id, fieldKey: f.key });
                }}
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="text-xs font-medium truncate">
                    {f.label}
                    {f.required && <span className="text-destructive ml-0.5">*</span>}
                  </div>
                  <button
                    className="text-muted-foreground hover:text-destructive shrink-0"
                    onClick={(e) => { e.stopPropagation(); removeField(f.key); }}
                    aria-label="필드 삭제"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {FIELD_TYPE_LABELS[f.type]} · {f.key}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
