/**
 * 양식 라이브 미리보기 — 실제 입력 폼처럼 렌더링 (읽기 전용 상태값).
 */
import { FormLayout, FormField } from '@/lib/permitFormTypes';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface Props {
  layout: FormLayout;
}

function widthClass(w?: number) {
  return w === 4 ? 'col-span-12' : w === 3 ? 'col-span-9' : w === 1 ? 'col-span-3' : 'col-span-6';
}

function FieldRender({ f }: { f: FormField }) {
  const labelEl = (
    <Label className="text-xs font-semibold">
      {f.label}
      {f.required && <span className="text-destructive ml-0.5">*</span>}
    </Label>
  );

  if (f.type === 'text' || f.type === 'auto')
    return (
      <div>
        {labelEl}
        <Input disabled placeholder={f.placeholder || (f.type === 'auto' ? `자동: ${f.autoSource}` : '')} className="h-8 bg-muted/30" />
      </div>
    );
  if (f.type === 'textarea')
    return <div>{labelEl}<Textarea disabled rows={f.rows || 3} placeholder={f.placeholder || ''} className="bg-muted/30" /></div>;
  if (f.type === 'number')
    return <div>{labelEl}<Input disabled type="number" placeholder={f.placeholder || ''} className="h-8 bg-muted/30" /></div>;
  if (f.type === 'date')
    return <div>{labelEl}<Input disabled type="date" className="h-8 bg-muted/30" /></div>;
  if (f.type === 'time')
    return <div>{labelEl}<Input disabled type="time" className="h-8 bg-muted/30" /></div>;
  if (f.type === 'daterange')
    return (
      <div>
        {labelEl}
        <div className="flex gap-1 items-center">
          <Input disabled type="date" className="h-8 bg-muted/30" />
          <span className="text-xs">~</span>
          <Input disabled type="date" className="h-8 bg-muted/30" />
        </div>
      </div>
    );
  if (f.type === 'select')
    return (
      <div>
        {labelEl}
        <select disabled className="w-full h-8 rounded border border-input bg-muted/30 px-2 text-sm">
          <option>선택...</option>
          {(f.options || []).map((o) => <option key={o.value}>{o.label}</option>)}
        </select>
      </div>
    );
  if (f.type === 'radio')
    return (
      <div>
        {labelEl}
        <RadioGroup disabled className="flex flex-wrap gap-3 mt-1">
          {(f.options || []).map((o) => (
            <div key={o.value} className="flex items-center gap-1">
              <RadioGroupItem value={o.value} id={`${f.key}_${o.value}`} disabled />
              <Label htmlFor={`${f.key}_${o.value}`} className="text-xs">{o.label}</Label>
            </div>
          ))}
        </RadioGroup>
      </div>
    );
  if (f.type === 'checkbox')
    return (
      <div className="flex items-center gap-2">
        <Checkbox disabled />
        <span className="text-sm">{f.label}</span>
      </div>
    );
  if (f.type === 'checkbox_group')
    return (
      <div>
        {labelEl}
        <div className="flex flex-wrap gap-3 mt-1">
          {(f.options || []).map((o) => (
            <div key={o.value} className="flex items-center gap-1">
              <Checkbox disabled />
              <span className="text-xs">{o.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  if (f.type === 'table')
    return (
      <div>
        {labelEl}
        <div className="border rounded overflow-hidden mt-1">
          <table className="w-full text-xs">
            <thead className="bg-muted">
              <tr>{(f.columns || []).map((c) => <th key={c.key} className="border-b p-1 text-left">{c.label}</th>)}</tr>
            </thead>
            <tbody>
              <tr>{(f.columns || []).map((c) => <td key={c.key} className="border-b p-1 text-muted-foreground">—</td>)}</tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  if (f.type === 'signature')
    return (
      <div>
        {labelEl}
        <div className="border-2 border-dashed border-muted-foreground/40 rounded h-16 flex items-center justify-center text-xs text-muted-foreground">
          서명란 ({f.signatureRole})
        </div>
      </div>
    );
  if (f.type === 'attachment')
    return (
      <div>
        {labelEl}
        <div className="border rounded p-2 text-xs text-muted-foreground bg-muted/30">📎 첨부파일 업로드</div>
      </div>
    );
  return null;
}

export default function LivePreview({ layout }: Props) {
  return (
    <div className="border rounded p-4 bg-white max-h-[75vh] overflow-auto">
      <div className="border-b pb-3 mb-4">
        <div className="text-center">
          <div className="text-xl font-bold">{layout.header.title || '(제목 없음)'}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {layout.header.doc_no} {layout.header.rev && `· ${layout.header.rev}`}
          </div>
          {layout.header.issuer && (
            <div className="text-xs mt-1">
              <span className="text-muted-foreground">{layout.header.issuer_label || '발행'}:</span> {layout.header.issuer}
            </div>
          )}
        </div>
      </div>
      {layout.sections.length === 0 && (
        <div className="text-center text-sm text-muted-foreground py-12">
          섹션이 없습니다. 빌더에서 섹션을 추가하세요.
        </div>
      )}
      <div className="space-y-5">
        {layout.sections.map((s) => (
          <div key={s.id}>
            <div className="text-sm font-bold border-b pb-1 mb-2">{s.title}</div>
            {s.description && <div className="text-xs text-muted-foreground mb-2">{s.description}</div>}
            <div className="grid grid-cols-12 gap-3">
              {s.fields.map((f) => (
                <div key={f.key} className={widthClass(f.width)}>
                  <FieldRender f={f} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
