/**
 * 표준 SF003 양식(내장) 스타일 편집기 — 열 너비 / 폰트 / 라벨.
 * 값은 permit_form_templates.layout_json.standard_style · standard_labels 에 저장.
 * 편집 즉시 우측 미리보기(DigPermitForm readOnly) 에 반영.
 */
import { useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { RotateCcw } from 'lucide-react';
import DigPermitForm, { PermitFormData, PermitType } from '@/components/permits/DigPermitForm';
import {
  DEFAULT_STANDARD_STYLE, DEFAULT_STANDARD_LABELS, mergeStandardStyle, mergeStandardLabels,
  COLUMN_LABELS, PERMIT_TYPE_LABEL,
  type StandardStyle, type StandardLabels, type PermitTypeKey,
} from '@/lib/permitStandardStyle';

interface Props {
  style: Partial<StandardStyle> | null | undefined;
  labels: Partial<StandardLabels> | null | undefined;
  onChange: (style: StandardStyle, labels: StandardLabels) => void;
}

const PERMIT_TYPES: PermitTypeKey[] = ['general', 'confined_space', 'hot_work', 'excavation'];

// 미리보기용 더미 데이터
const DEMO_DATA: PermitFormData = {
  contractor_company: '(주)샘플건설',
  work_name: '배관 용접 작업',
  work_description: '냉각탑 상부 배관 T-이음 용접',
  work_location: '냉각탑 3F 배관 랙',
  personnel_count: 4,
  applicant_company: '(주)샘플건설',
  applicant_name: '홍길동',
};

export default function StandardStyleEditor({ style, labels, onChange }: Props) {
  const merged = useMemo(() => mergeStandardStyle(style || null), [style]);
  const mergedLabels = useMemo(() => mergeStandardLabels(labels || null), [labels]);

  const updateStyle = (patch: Partial<StandardStyle>) => onChange({ ...merged, ...patch }, mergedLabels);
  const updateLabels = (patch: Partial<StandardLabels>) => onChange(merged, { ...mergedLabels, ...patch });

  const updateCol = (pt: PermitTypeKey, idx: number, v: number | 'auto') => {
    const cols = (merged.columns[pt] || DEFAULT_STANDARD_STYLE.columns[pt] || []).slice();
    cols[idx] = v;
    updateStyle({ columns: { ...merged.columns, [pt]: cols } });
  };

  const resetCols = (pt: PermitTypeKey) => {
    updateStyle({ columns: { ...merged.columns, [pt]: DEFAULT_STANDARD_STYLE.columns[pt] } });
  };

  const resetAll = () => onChange(DEFAULT_STANDARD_STYLE, DEFAULT_STANDARD_LABELS);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-4">
      {/* 좌: 편집 패널 */}
      <div className="space-y-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">공통 라벨</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div>
              <Label className="text-xs">승인업체명</Label>
              <Input
                value={mergedLabels.approverCompany || ''}
                onChange={(e) => updateLabels({ approverCompany: e.target.value })}
                placeholder="에어리퀴드"
              />
            </div>
            <div>
              <Label className="text-xs">문서번호 접두사</Label>
              <Input
                value={mergedLabels.docNoPrefix || ''}
                onChange={(e) => updateLabels({ docNoPrefix: e.target.value })}
                placeholder="MD-000000-SF003"
              />
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
          <CardHeader className="pb-2"><CardTitle className="text-sm">열 너비 (px)</CardTitle></CardHeader>
          <CardContent>
            <Tabs defaultValue="general">
              <TabsList className="w-full grid grid-cols-4 h-8">
                {PERMIT_TYPES.map((pt) => (
                  <TabsTrigger key={pt} value={pt} className="text-xs">{PERMIT_TYPE_LABEL[pt]}</TabsTrigger>
                ))}
              </TabsList>
              {PERMIT_TYPES.map((pt) => {
                const cols = merged.columns[pt] || DEFAULT_STANDARD_STYLE.columns[pt] || [];
                const labs = COLUMN_LABELS[pt] || [];
                return (
                  <TabsContent key={pt} value={pt} className="pt-3 space-y-2">
                    {cols.map((w, i) => (
                      <div key={i} className="grid grid-cols-[1fr_90px_60px] gap-2 items-center">
                        <div className="text-xs truncate">{labs[i] || `열 ${i + 1}`}</div>
                        <Input
                          className="h-7 text-xs"
                          type="number"
                          min={40}
                          max={400}
                          value={w === 'auto' ? '' : w}
                          placeholder="auto"
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            if (!raw) return updateCol(pt, i, 'auto');
                            const n = Math.max(40, Math.min(400, Number(raw) || 100));
                            updateCol(pt, i, n);
                          }}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px] px-2"
                          onClick={() => updateCol(pt, i, w === 'auto' ? (DEFAULT_STANDARD_STYLE.columns[pt]?.[i] ?? 100) : 'auto')}
                          title="auto 토글"
                        >
                          {w === 'auto' ? '고정' : 'auto'}
                        </Button>
                      </div>
                    ))}
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => resetCols(pt)}>
                      <RotateCcw className="h-3 w-3 mr-1" /> 기본값 복원
                    </Button>
                  </TabsContent>
                );
              })}
            </Tabs>
          </CardContent>
        </Card>

        <Button variant="outline" size="sm" onClick={resetAll} className="w-full">
          <RotateCcw className="h-3 w-3 mr-1" /> 전체 기본값으로 복원
        </Button>
      </div>

      {/* 우: 미리보기 */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">실시간 미리보기 (일반)</CardTitle></CardHeader>
        <CardContent className="overflow-auto max-h-[75vh] p-2">
          <DigPermitForm
            permitType="general"
            data={DEMO_DATA}
            signatures={{}}
            readOnly
            projectName="샘플 프로젝트"
            standardStyle={merged}
            standardLabels={mergedLabels}
          />
          <div className="border-t my-4" />
          <div className="text-xs text-muted-foreground mb-1">밀폐공간 미리보기</div>
          <DigPermitForm
            permitType="confined_space"
            data={DEMO_DATA}
            signatures={{}}
            readOnly
            projectName="샘플 프로젝트"
            standardStyle={merged}
            standardLabels={mergedLabels}
          />
        </CardContent>
      </Card>
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
