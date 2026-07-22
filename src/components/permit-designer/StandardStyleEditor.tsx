/**
 * 표준 SF003 양식(내장) 스타일 편집기 — 폼별 열/색/행높이 + 공통 폰트/로고/라벨.
 * 값은 permit_form_templates.layout_json.standard_style · standard_labels 에 저장.
 * 편집 즉시 우측 미리보기(DigPermitForm readOnly) 에 반영.
 */
import { useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { RotateCcw, ImagePlus, X } from 'lucide-react';
import DigPermitForm, { PermitFormData, PermitSignatures } from '@/components/permits/DigPermitForm';
import {
  DEFAULT_STANDARD_STYLE, DEFAULT_STANDARD_LABELS, DEFAULT_TYPE_STYLE,
  mergeStandardStyle, mergeStandardLabels, mergeTypeStyle,
  COLUMN_LABELS, PERMIT_TYPE_LABEL,
  type StandardStyle, type StandardLabels, type PermitTypeStyle, type PermitTypeKey,
} from '@/lib/permitStandardStyle';

interface Props {
  style: Partial<StandardStyle> | null | undefined;
  labels: Partial<StandardLabels> | null | undefined;
  onChange: (style: StandardStyle, labels: StandardLabels) => void;
}

const PERMIT_TYPES: PermitTypeKey[] = ['general', 'confined_space', 'hot_work', 'excavation'];

const DEMO_DATA: PermitFormData = {
  contractor_company: '(주)샘플건설',
  work_name: '배관 용접 작업',
  work_description: '냉각탑 상부 배관 T-이음 용접',
  work_location: '냉각탑 3F 배관 랙',
  personnel_count: 4,
  applicant_company: '(주)샘플건설',
  applicant_name: '홍길동',
};
const DEMO_SIGS: PermitSignatures = {};

export default function StandardStyleEditor({ style, labels, onChange }: Props) {
  const merged = useMemo(() => mergeStandardStyle(style || null), [style]);
  const mergedLabels = useMemo(() => mergeStandardLabels(labels || null), [labels]);
  const [activeType, setActiveType] = useState<PermitTypeKey>('general');
  const [previewMode, setPreviewMode] = useState<'screen' | 'print'>('screen');

  const updateStyle = (patch: Partial<StandardStyle>) => onChange({ ...merged, ...patch }, mergedLabels);
  const updateLabels = (patch: Partial<StandardLabels>) => onChange(merged, { ...mergedLabels, ...patch });

  const currentTypeStyle: PermitTypeStyle = mergeTypeStyle(merged.perType?.[activeType]);
  const updateTypeStyle = (patch: Partial<PermitTypeStyle>) => {
    const next = { ...currentTypeStyle, ...patch };
    updateStyle({ perType: { ...(merged.perType || {}), [activeType]: next } });
  };

  const updateCol = (idx: number, v: number | 'auto') => {
    const cols = (merged.columns[activeType] || DEFAULT_STANDARD_STYLE.columns[activeType] || []).slice();
    cols[idx] = v;
    updateStyle({ columns: { ...merged.columns, [activeType]: cols } });
  };

  const resetType = () => {
    updateStyle({
      columns: { ...merged.columns, [activeType]: DEFAULT_STANDARD_STYLE.columns[activeType] },
      perType: { ...(merged.perType || {}), [activeType]: { ...DEFAULT_TYPE_STYLE } },
    });
  };

  const resetAll = () => onChange(DEFAULT_STANDARD_STYLE, DEFAULT_STANDARD_LABELS);

  const onLogoFile = async (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => updateStyle({ logoUrl: String(reader.result) });
    reader.readAsDataURL(file);
  };

  const cols = merged.columns[activeType] || DEFAULT_STANDARD_STYLE.columns[activeType] || [];
  const colLabs = COLUMN_LABELS[activeType] || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[440px_1fr] gap-4">
      {/* 좌: 편집 패널 */}
      <div className="space-y-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">공통 (모든 허가서 종류)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div>
              <Label className="text-xs">승인업체명 (헤더 표시)</Label>
              <Input value={mergedLabels.approverCompany || ''} onChange={(e) => updateLabels({ approverCompany: e.target.value })} placeholder="Air Liquide Korea" />
            </div>
            <div>
              <Label className="text-xs">문서번호 접두사</Label>
              <Input value={mergedLabels.docNoPrefix || ''} onChange={(e) => updateLabels({ docNoPrefix: e.target.value })} placeholder="GEN-000000-SF003" />
            </div>
            <div>
              <Label className="text-xs">좌상단 로고</Label>
              <div className="flex items-center gap-2 mt-1">
                {merged.logoUrl ? (
                  <div className="flex items-center gap-2 border rounded p-1">
                    <img src={merged.logoUrl} alt="logo" className="h-8 max-w-[120px] object-contain" />
                    <Button size="sm" variant="ghost" onClick={() => updateStyle({ logoUrl: '' })} className="h-6 px-2"><X className="h-3 w-3" /></Button>
                  </div>
                ) : (
                  <label className="inline-flex items-center gap-1 border rounded px-2 py-1 text-xs cursor-pointer hover:bg-accent">
                    <ImagePlus className="h-3.5 w-3.5" /> 이미지 선택
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => onLogoFile(e.target.files?.[0] || null)} />
                  </label>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">제목 정렬</Label>
                <select className="h-8 w-full rounded border bg-background text-sm px-2" value={merged.titleAlign || 'center'} onChange={(e) => updateStyle({ titleAlign: e.target.value as any })}>
                  <option value="left">왼쪽</option>
                  <option value="center">가운데</option>
                  <option value="right">오른쪽</option>
                </select>
              </div>
              <ColorPicker label="제목 색" value={merged.titleColor || '#000000'} onChange={(v) => updateStyle({ titleColor: v })} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">폰트 크기</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <FontSlider label="본문" value={merged.bodyFontPt || 10} min={7} max={14} onChange={(v) => updateStyle({ bodyFontPt: v })} />
            <FontSlider label="제목" value={merged.titleFontPt || 18} min={12} max={26} onChange={(v) => updateStyle({ titleFontPt: v })} />
            <FontSlider label="세부 라벨" value={merged.smallFontPt || 9} min={7} max={12} onChange={(v) => updateStyle({ smallFontPt: v })} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">허가서 종류별 설정</CardTitle></CardHeader>
          <CardContent>
            <Tabs value={activeType} onValueChange={(v) => setActiveType(v as PermitTypeKey)}>
              <TabsList className="w-full grid grid-cols-4 h-8">
                {PERMIT_TYPES.map((pt) => (
                  <TabsTrigger key={pt} value={pt} className="text-xs">{PERMIT_TYPE_LABEL[pt]}</TabsTrigger>
                ))}
              </TabsList>
              {PERMIT_TYPES.map((pt) => (
                <TabsContent key={pt} value={pt} className="pt-3 space-y-3">
                  <div>
                    <Label className="text-xs font-semibold">색상</Label>
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      <ColorPicker label="라벨 셀 배경" value={currentTypeStyle.labelBg || '#DCE6F1'} onChange={(v) => updateTypeStyle({ labelBg: v })} />
                      <ColorPicker label="값 셀 배경" value={currentTypeStyle.valueBg || '#FFFFFF'} onChange={(v) => updateTypeStyle({ valueBg: v })} />
                      <ColorPicker label="테두리" value={currentTypeStyle.borderColor || '#000000'} onChange={(v) => updateTypeStyle({ borderColor: v })} />
                      <ColorPicker label="강조 텍스트" value={currentTypeStyle.emphasisColor || '#C00000'} onChange={(v) => updateTypeStyle({ emphasisColor: v })} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1"><span>행 높이</span><span className="font-mono">{currentTypeStyle.rowHeightPx || 24}px</span></div>
                    <Slider value={[currentTypeStyle.rowHeightPx || 24]} min={18} max={60} step={1} onValueChange={(v) => updateTypeStyle({ rowHeightPx: v[0] })} />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold">열 너비 (px)</Label>
                    <div className="space-y-1 mt-1">
                      {cols.map((w, i) => (
                        <div key={i} className="grid grid-cols-[1fr_90px_60px] gap-2 items-center">
                          <div className="text-xs truncate">{colLabs[i] || `열 ${i + 1}`}</div>
                          <Input
                            className="h-7 text-xs"
                            type="number"
                            min={40}
                            max={400}
                            value={w === 'auto' ? '' : w}
                            placeholder="auto"
                            onChange={(e) => {
                              const raw = e.target.value.trim();
                              if (!raw) return updateCol(i, 'auto');
                              const n = Math.max(40, Math.min(400, Number(raw) || 100));
                              updateCol(i, n);
                            }}
                          />
                          <Button size="sm" variant="outline" className="h-7 text-[11px] px-2"
                            onClick={() => updateCol(i, w === 'auto' ? (DEFAULT_STANDARD_STYLE.columns[pt]?.[i] ?? 100) : 'auto')}>
                            {w === 'auto' ? '고정' : 'auto'}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={resetType}>
                    <RotateCcw className="h-3 w-3 mr-1" /> {PERMIT_TYPE_LABEL[pt]} 기본값 복원
                  </Button>
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>

        <Button variant="outline" size="sm" onClick={resetAll} className="w-full">
          <RotateCcw className="h-3 w-3 mr-1" /> 전체 기본값으로 복원
        </Button>
      </div>

      {/* 우: 미리보기 (선택된 종류) */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">실시간 미리보기 — {PERMIT_TYPE_LABEL[activeType]}</CardTitle>
          <div className="flex gap-1">
            <Button size="sm" variant={previewMode === 'screen' ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setPreviewMode('screen')}>화면</Button>
            <Button size="sm" variant={previewMode === 'print' ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setPreviewMode('print')}>인쇄(A4)</Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-auto max-h-[80vh] p-2 bg-muted/30">
          <div style={previewMode === 'print' ? { width: '210mm', minHeight: '297mm', margin: '0 auto', background: '#fff', padding: '12mm', boxShadow: '0 0 8px rgba(0,0,0,0.15)' } : { background: '#fff', padding: 8 }}>
            <DigPermitForm
              permitType={activeType as any}
              data={DEMO_DATA}
              signatures={DEMO_SIGS}
              readOnly
              printMode={previewMode === 'print'}
              projectName="샘플 프로젝트"
              standardStyle={merged}
              standardLabels={mergedLabels}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-1 border rounded px-1 h-8">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="w-6 h-6 border-0 bg-transparent cursor-pointer" />
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className="flex-1 h-7 bg-transparent text-xs font-mono outline-none" />
      </div>
    </div>
  );
}

function FontSlider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1"><span>{label}</span><span className="font-mono">{value}pt</span></div>
      <Slider value={[value]} min={min} max={max} step={1} onValueChange={(v) => onChange(v[0])} />
    </div>
  );
}
