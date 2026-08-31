import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Calculator, CheckCircle2, AlertTriangle, XCircle, Save, Lightbulb, Truck } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  calculateFullRigging,
  getWireBreakingLoad,
  getShackleSafeLoadByInch,
  getSlingBeltRatedLoadByWidth,
  getRoundSlingRatedLoadByColor,
  getChainSlingLoad,
  lookupCraneCapacity,
  mmToInch,
  resolveWindRule,
  isConditionDerated,
  CONDITION_DERATE,
  WIND_SPEED_BANDS,
  TERMINAL_METHOD_EFFICIENCY,
  SLING_MATERIAL_OPTIONS,
  SLING_BELT_BY_WIDTH,
  ROUND_SLING_BY_COLOR,
  CHAIN_SLING_LOAD,
  SHACKLE_INCH_LOAD,
  CRANE_PRESETS,
  type RiggingResult,
  type SlingMaterialType,
} from '@/lib/riggingCalculator';
import { roundSlingSwatch } from '@/lib/riggingHardwareCatalog';
import { buildRiggingInputFromRow, riggingResultToPatch } from '@/lib/riggingDerived';

interface RiggingPlanFormProps {
  rigging: any;
  onChange: (field: string, value: any) => void;
  /** Batch derived calc fields without marking the parent form dirty. */
  onDerivedPatch?: (patch: Record<string, any>) => void;
  onSave: () => void;
  saving: boolean;
  readOnly?: boolean;
}

const numVal = (v: any) => Number(v) || 0;

export default function RiggingPlanForm({ rigging, onChange, onDerivedPatch, onSave, saving, readOnly }: RiggingPlanFormProps) {
  const [result, setResult] = useState<RiggingResult | null>(null);
  const [windInputMode, setWindInputMode] = useState<'select' | 'custom'>('select');
  const [customWindSpeed, setCustomWindSpeed] = useState('');
  const onChangeRef = useRef(onChange);
  const onDerivedPatchRef = useRef(onDerivedPatch);
  onChangeRef.current = onChange;
  onDerivedPatchRef.current = onDerivedPatch;

  const applyDerived = useCallback((patch: Record<string, any>) => {
    if (!patch || Object.keys(patch).length === 0) return;
    if (onDerivedPatchRef.current) {
      onDerivedPatchRef.current(patch);
      return;
    }
    for (const [k, v] of Object.entries(patch)) onChangeRef.current(k, v);
  }, []);

  const recalc = useCallback(() => {
    if (!rigging) return;
    const r = calculateFullRigging(buildRiggingInputFromRow(rigging));
    setResult(r);
    applyDerived(riggingResultToPatch(r));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- field deps below drive refresh
  }, [rigging, applyDerived]);

  useEffect(() => {
    const g = String(rigging?.wind_speed_grade || "");
    const m = g.match(/^(\d+(?:\.\d+)?)\s*m\/s/i);
    if (m) {
      setWindInputMode("custom");
      setCustomWindSpeed(m[1]);
    }
  }, [rigging?.wind_speed_grade]);

  useEffect(() => { recalc(); }, [
    rigging?.load_weight, rigging?.hook_weight, rigging?.shackle_weight_val, rigging?.sling_rigging_weight,
    rigging?.load_weight_min, rigging?.hook_weight_min, rigging?.shackle_weight_min, rigging?.sling_rigging_weight_min,
    rigging?.crane_capacity, rigging?.rated_capacity, rigging?.working_radius, rigging?.boom_length,
    rigging?.wire_diameter_mm, rigging?.sling_count, rigging?.sling_angle_deg, rigging?.wire_safety_coefficient,
    rigging?.wind_speed_factor, rigging?.wind_speed_grade, rigging?.boom_rotation_factor, rigging?.ground_inspection_factor,
    rigging?.load_protrusion_factor, rigging?.shackle_inch, rigging?.shackle_qty,
    rigging?.wire_terminal_method, rigging?.outrigger_distance,
    rigging?.sling_material_type, rigging?.sling_belt_color, rigging?.sling_belt_rated_load,
    rigging?.sling_belt_width_mm,
    rigging?.round_sling_rated_load, rigging?.chain_diameter_mm, rigging?.chain_leg_count,
  ]);

  // Auto-set wire breaking load
  useEffect(() => {
    if (rigging?.wire_diameter_mm > 0 && rigging?.sling_material_type === 'wire_rope') {
      const bl = getWireBreakingLoad(numVal(rigging.wire_diameter_mm));
      const inch = parseFloat(mmToInch(numVal(rigging.wire_diameter_mm)).toFixed(2));
      const patch: Record<string, any> = { wire_diameter_inch: inch };
      if (bl > 0) patch.wire_breaking_load = bl;
      applyDerived(patch);
    }
  }, [rigging?.wire_diameter_mm, rigging?.sling_material_type, applyDerived]);

  // Auto-set sling belt rated load by width
  useEffect(() => {
    if (rigging?.sling_belt_width_mm > 0 && rigging?.sling_material_type === 'sling_belt') {
      const rl = getSlingBeltRatedLoadByWidth(numVal(rigging.sling_belt_width_mm));
      if (rl > 0) applyDerived({ sling_belt_rated_load: rl });
    }
  }, [rigging?.sling_belt_width_mm, rigging?.sling_material_type, applyDerived]);

  // Auto-set round sling rated load by color
  useEffect(() => {
    if (rigging?.sling_belt_color && rigging?.sling_material_type === 'round_sling') {
      const rl = getRoundSlingRatedLoadByColor(rigging.sling_belt_color);
      if (rl > 0) applyDerived({ round_sling_rated_load: rl });
    }
  }, [rigging?.sling_belt_color, rigging?.sling_material_type, applyDerived]);

  // Auto-set chain load
  useEffect(() => {
    if (rigging?.chain_diameter_mm > 0 && rigging?.sling_material_type === 'chain_sling') {
      const cl = getChainSlingLoad(numVal(rigging.chain_diameter_mm));
      if (cl > 0) applyDerived({ sling_capacity: cl });
    }
  }, [rigging?.chain_diameter_mm, rigging?.sling_material_type, applyDerived]);

  // Auto-set shackle safe load
  useEffect(() => {
    if (rigging?.shackle_inch) {
      const sl = getShackleSafeLoadByInch(rigging.shackle_inch);
      if (sl > 0) applyDerived({ shackle_safe_load: sl });
    }
  }, [rigging?.shackle_inch, applyDerived]);

  const materialType = (rigging?.sling_material_type || 'wire_rope') as SlingMaterialType;

  const handlePresetSelect = (presetId: string) => {
    const preset = CRANE_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    onChange('equipment_name', preset.name);
    onChange('crane_model', preset.name);
    onChange('rated_capacity', preset.ratedCapacity);
    if (preset.defaultBoomLength > 0) onChange('boom_length', preset.defaultBoomLength);
    if (preset.defaultWorkingRadius > 0) onChange('working_radius', preset.defaultWorkingRadius);
    if (preset.chartVerified) {
      const cap = lookupCraneCapacity(preset, preset.defaultBoomLength, preset.defaultWorkingRadius);
      if (cap > 0) onChange('crane_capacity', cap);
    } else if (preset.defaultCapacityAtPoint != null) {
      onChange('crane_capacity', preset.defaultCapacityAtPoint);
    }
  };

  // Verified manufacturer charts only — never interpolate invented tables.
  useEffect(() => {
    const presetName = rigging?.equipment_name || rigging?.crane_model || '';
    const preset = CRANE_PRESETS.find(p => p.name === presetName);
    if (!preset?.chartVerified) return;
    if (rigging?.boom_length > 0 && rigging?.working_radius > 0) {
      const cap = lookupCraneCapacity(preset, numVal(rigging.boom_length), numVal(rigging.working_radius));
      if (cap > 0 && cap !== numVal(rigging.crane_capacity)) {
        onChange('crane_capacity', cap);
      }
    }
  }, [rigging?.boom_length, rigging?.working_radius]);

  const field = (label: string, key: string, type: string = 'number', opts?: { unit?: string; disabled?: boolean; highlight?: boolean }) => (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-1">
        <Input
          type={type}
          value={rigging?.[key] ?? ''}
          onChange={e => onChange(key, type === 'number' ? e.target.value : e.target.value)}
          className={`h-8 text-xs ${opts?.disabled ? 'bg-muted' : ''} ${opts?.highlight ? 'bg-yellow-50 dark:bg-yellow-950/30 font-bold' : ''}`}
          disabled={opts?.disabled}
        />
        {opts?.unit && <span className="text-[10px] text-muted-foreground whitespace-nowrap">{opts.unit}</span>}
      </div>
    </div>
  );

  const okBadge = (ok: boolean | undefined) => ok === undefined ? null : ok ? (
    <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px] gap-1">
      <CheckCircle2 className="h-3 w-3" /> O.K
    </Badge>
  ) : (
    <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-[10px] gap-1">
      <XCircle className="h-3 w-3" /> N.G
    </Badge>
  );

  if (!rigging) return null;

  return (
    <div className={`space-y-4 ${readOnly ? 'pointer-events-none' : ''}`}>
      {/* 안전계수 */}
      <Card className="bg-muted/30">
        <CardContent className="py-3 px-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">안전계수 프로그램 적용</span>
            <div className="flex gap-4">
              <span>근로자탑승: <strong>{rigging.safety_factor_passenger || 10}</strong></span>
              <span>화물하중달기: <strong>{rigging.safety_factor_cargo || 5}</strong></span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 1. 공사개요 */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">1. 공사개요</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            {field('작업 내용', 'load_description', 'text')}
            {field('작업 장소', 'outrigger_setup', 'text')}
            {field('작업 기간', 'notes', 'text')}
            {field('작업지휘자', 'lifting_method', 'text')}
          </div>
        </CardContent>
      </Card>

      {/* 2. 양중기 제원 + 프리셋 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">2. 양중기 제원</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Preset selector */}
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Truck className="h-3 w-3" /> 장비 프리셋 (빠른 선택)
            </Label>
            <div className="flex gap-2 flex-wrap">
              {CRANE_PRESETS.map(p => (
                <Button
                  key={p.id}
                  variant={rigging.equipment_name === p.name ? 'default' : 'outline'}
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => handlePresetSelect(p.id)}
                >
                  {p.name}
                </Button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              250/300톤은 제조사 최대점만 채웁니다(CKE2500-2: 250t×4.6m, LR 1300: 300t×4.3m).
              다른 붐·반경의 인양능력은 제원표/LMI를 직접 입력하세요. 추정 보간하지 않습니다.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-px bg-border rounded overflow-hidden">
            <div className="bg-card p-2">{field('장비 명', 'equipment_name', 'text')}</div>
            <div className="bg-card p-2">{field('정격하중', 'rated_capacity', 'number', { unit: 'ton' })}</div>
            <div className="bg-card p-2">{field('크레인 기종', 'crane_model', 'text')}</div>
            <div className="bg-card p-2">{field('붐 길이', 'boom_length', 'number', { unit: 'm' })}</div>
            <div className="bg-card p-2">{field('작업반경', 'working_radius', 'number', { unit: 'm' })}</div>
            <div className="bg-card p-2">{field('인양능력', 'crane_capacity', 'number', { unit: 'ton', highlight: true })}</div>
            <div className="bg-card p-2">{field('아웃리거 거리', 'outrigger_distance', 'number', { unit: 'm' })}</div>
          </div>
        </CardContent>
      </Card>

      {/* 3. 줄걸이 재료 및 제원 */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">3. 줄걸이 재료 및 제원</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">줄걸이 재료 선택</Label>
            <Select value={materialType} onValueChange={v => onChange('sling_material_type', v)}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SLING_MATERIAL_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* 공통 */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground">줄걸이 공통</h4>
              <div className="grid grid-cols-2 gap-2">
                {field('인양각도(수평면)', 'sling_angle_deg', 'number', { unit: '°' })}
                {field('줄걸이 수', 'sling_count', 'number')}
              </div>
              <p className="text-[9px] text-muted-foreground leading-relaxed">
                줄과 수평면이 이루는 각. 60° 권고 · 장력계수 1/sinθ (수직 90°=1.00, 60°≈1.16)
              </p>
            </div>

            {/* Material-specific */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground">
                {SLING_MATERIAL_OPTIONS.find(o => o.value === materialType)?.label} 상세
              </h4>

              {materialType === 'wire_rope' && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    {field('규격', 'wire_diameter_mm', 'number', { unit: 'mm' })}
                    {field('규격 (inch)', 'wire_diameter_inch', 'number', { unit: 'inch', disabled: true })}
                    {field('절단하중', 'wire_breaking_load', 'number', { unit: 'ton', disabled: true, highlight: true })}
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">단말가공법</Label>
                      <Select value={rigging.wire_terminal_method || '탐블(24mm 이하)'} onValueChange={v => onChange('wire_terminal_method', v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.keys(TERMINAL_METHOD_EFFICIENCY).map(m => (
                            <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {field('안전계수', 'wire_safety_coefficient', 'number')}
                    {field('안전하중', 'wire_safe_load', 'number', { unit: 'ton', disabled: true })}
                  </div>
                </div>
              )}

              {materialType === 'sling_belt' && (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">폭 (mm) - 정격하중 자동</Label>
                    <Select value={String(rigging.sling_belt_width_mm || '')} onValueChange={v => {
                      const w = Number(v);
                      onChange('sling_belt_width_mm', w);
                      const rl = getSlingBeltRatedLoadByWidth(w);
                      onChange('sling_belt_rated_load', rl);
                    }}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="폭 선택" /></SelectTrigger>
                      <SelectContent>
                        {SLING_BELT_BY_WIDTH.map(s => (
                          <SelectItem key={s.widthMm} value={String(s.widthMm)} className="text-xs">
                            {s.widthMm}mm ({s.ratedLoad}톤)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {field('정격하중', 'sling_belt_rated_load', 'number', { unit: 'ton', disabled: true, highlight: true })}
                  </div>
                </div>
              )}

              {materialType === 'round_sling' && (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">색상·정격하중 (EN 1492-2, 주황은 라벨 WLL)</Label>
                    <Select value={rigging.sling_belt_color || ''} onValueChange={v => {
                      onChange('sling_belt_color', v);
                      const rl = getRoundSlingRatedLoadByColor(v);
                      onChange('round_sling_rated_load', rl);
                    }}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="색상·톤수 선택" /></SelectTrigger>
                      <SelectContent>
                        {ROUND_SLING_BY_COLOR.map(s => (
                          <SelectItem key={s.id} value={s.id} className="text-xs">
                            <span className="flex items-center gap-2">
                              <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: roundSlingSwatch(s.color) }} />
                              {s.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {field('정격하중', 'round_sling_rated_load', 'number', { unit: 'ton', disabled: true, highlight: true })}
                  </div>
                </div>
              )}

              {materialType === 'chain_sling' && (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">체인 규격</Label>
                    <Select value={String(rigging.chain_diameter_mm || '')} onValueChange={v => {
                      onChange('chain_diameter_mm', Number(v));
                    }}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="규격 선택" /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(CHAIN_SLING_LOAD).map(([mm, load]) => (
                          <SelectItem key={mm} value={mm} className="text-xs">{mm}mm ({load}톤/줄)</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {field('줄 수', 'chain_leg_count', 'number')}
                    {field('허용하중/줄', 'sling_capacity', 'number', { unit: 'ton', disabled: true, highlight: true })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* 샤클 */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">체결 장구 (샤클)</h4>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">규격 (Crosby G-2130 WLL)</Label>
                <Select value={rigging.shackle_inch || ''} onValueChange={v => onChange('shackle_inch', v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="인치 선택" /></SelectTrigger>
                  <SelectContent>
                    {SHACKLE_INCH_LOAD.map(s => (
                      <SelectItem key={s.inch} value={s.inch} className="text-xs">{s.label} ({s.safeLoad}톤)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {field('안전하중', 'shackle_safe_load', 'number', { unit: 'ton', disabled: true, highlight: true })}
              {field('사용 갯수', 'shackle_qty', 'number')}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 4. 중량물 제원 */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">4. 중량물 제원</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-red-600">중량물 1 (최대)</h4>
              {field('품명', 'load_name_max', 'text')}
              <div className="grid grid-cols-2 gap-2">
                {field('인양물', 'load_weight', 'number', { unit: 'ton' })}
                {field('HOOK', 'hook_weight', 'number', { unit: 'ton' })}
                {field('샤클', 'shackle_weight_val', 'number', { unit: 'ton' })}
                {field('슬링/리깅', 'sling_rigging_weight', 'number', { unit: 'ton' })}
              </div>
              <div className="flex items-center gap-2 pt-1 border-t">
                <span className="text-xs font-bold">총중량:</span>
                <span className="text-sm font-bold text-red-600">{result?.totalWeightMax?.toFixed(3) || '0'} 톤</span>
              </div>
            </div>
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-blue-600">중량물 2 (최소)</h4>
              {field('품명', 'load_name_min', 'text')}
              <div className="grid grid-cols-2 gap-2">
                {field('인양물', 'load_weight_min', 'number', { unit: 'ton' })}
                {field('HOOK', 'hook_weight_min', 'number', { unit: 'ton' })}
                {field('샤클', 'shackle_weight_min', 'number', { unit: 'ton' })}
                {field('슬링/리깅', 'sling_rigging_weight_min', 'number', { unit: 'ton' })}
              </div>
              <div className="flex items-center gap-2 pt-1 border-t">
                <span className="text-xs font-bold">총중량:</span>
                <span className="text-sm font-bold text-blue-600">{result?.totalWeightMin?.toFixed(3) || '0'} 톤</span>
              </div>
            </div>
          </div>
          {result && result.tensionPerLeg > 0 && (
            <div className="mt-3 p-2 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
              <p className="text-xs font-semibold">1줄당 장력 (T): <span className="text-amber-700 dark:text-amber-400 text-sm">{result.tensionPerLeg.toFixed(2)} 톤</span></p>
              <p className="text-[10px] text-muted-foreground">
                T = 줄하중({result.slingLoadTon.toFixed(2)}t, 훅 제외) × (1/sin{rigging.sling_angle_deg || 60}°) / 줄수({rigging.sling_count || 2})
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 5. 장비 안전성 검토 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">5. 장비 안전성 검토</CardTitle>
            {okBadge(result?.equipmentOk)}
          </div>
        </CardHeader>
        <CardContent>
          {(() => {
            const windRule = resolveWindRule({ grade: rigging.wind_speed_grade });
            const listed = WIND_SPEED_BANDS.some((b) => b.range === (rigging.wind_speed_grade || '0~5'));
            const selectGrade = listed ? (rigging.wind_speed_grade || '0~5') : windRule.range;
            const customRule = resolveWindRule({ speedMs: Number(customWindSpeed) || 0 });
            const toggleCond = (fieldName: string, on: boolean) => {
              onChange(fieldName, on ? CONDITION_DERATE : 1);
            };
            return (
          <>
          <div className="grid grid-cols-2 gap-px bg-border rounded overflow-hidden text-xs">
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">풍속</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">판정</div>

            <div className="bg-card p-2">
              {windInputMode === 'select' ? (
                <div className="space-y-1">
                  <Select value={selectGrade} onValueChange={v => {
                    if (v === 'custom') {
                      setWindInputMode('custom');
                      return;
                    }
                    const wf = WIND_SPEED_BANDS.find(w => w.range === v);
                    onChange('wind_speed_grade', v);
                    onChange('wind_speed_factor', wf?.factor ?? 1);
                  }}>
                    <SelectTrigger className="h-8 text-[10px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {WIND_SPEED_BANDS.map(w => (
                        <SelectItem key={w.range} value={w.range} className="text-xs">
                          {w.range === '10~' ? '10m/s 이상' : `${w.range} m/s`} — {w.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="custom" className="text-xs font-medium">직접 입력 (m/s)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[9px] text-muted-foreground leading-snug">{windRule.legal}</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      placeholder="m/s"
                      value={customWindSpeed}
                      onChange={e => {
                        setCustomWindSpeed(e.target.value);
                        const speed = Number(e.target.value);
                        const rule = resolveWindRule({ speedMs: Number.isFinite(speed) ? speed : 0 });
                        onChange('wind_speed_factor', rule.factor);
                        onChange('wind_speed_grade', Number.isFinite(speed) ? `${speed}m/s` : '0~5');
                      }}
                      className="h-7 text-[10px] w-16"
                    />
                    <Button variant="ghost" size="sm" className="h-6 text-[9px] px-1" onClick={() => {
                      setWindInputMode('select');
                      const rule = resolveWindRule({ speedMs: Number(customWindSpeed) || 0 });
                      onChange('wind_speed_grade', rule.range);
                      onChange('wind_speed_factor', rule.factor);
                    }}>
                      목록
                    </Button>
                  </div>
                  <p className={`text-[9px] font-medium ${customRule.stopWork ? 'text-red-600' : customRule.factor < 1 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                    {customRule.stopWork
                      ? `작업 중지 — ${customRule.legal}`
                      : `${customRule.label} · ${customRule.legal}`}
                  </p>
                </div>
              )}
            </div>
            <div className="bg-card p-2 flex flex-col items-center justify-center">
              {okBadge(result?.equipmentOk)}
            </div>
          </div>

          <div className="mt-3 space-y-2 rounded border p-2">
            <p className="text-[10px] font-medium">해당할 때만 정격 80% (규칙 제147조 사용설명서)</p>
            <div className="grid grid-cols-3 gap-2 text-[10px]">
              <label className="flex items-start gap-1.5 cursor-pointer">
                <Checkbox
                  checked={isConditionDerated(rigging.boom_rotation_factor)}
                  onCheckedChange={(c) => toggleCond('boom_rotation_factor', c === true)}
                  className="mt-0.5"
                />
                <span>선회 인양 중<br /><span className="text-muted-foreground">×0.8</span></span>
              </label>
              <label className="flex items-start gap-1.5 cursor-pointer">
                <Checkbox
                  checked={isConditionDerated(rigging.ground_inspection_factor)}
                  onCheckedChange={(c) => toggleCond('ground_inspection_factor', c === true)}
                  className="mt-0.5"
                />
                <span>지반 경사<br /><span className="text-muted-foreground">×0.8</span></span>
              </label>
              <label className="flex items-start gap-1.5 cursor-pointer">
                <Checkbox
                  checked={isConditionDerated(rigging.load_protrusion_factor)}
                  onCheckedChange={(c) => toggleCond('load_protrusion_factor', c === true)}
                  className="mt-0.5"
                />
                <span>하중 주행<br /><span className="text-muted-foreground">×0.8</span></span>
              </label>
            </div>
            <p className="text-[9px] text-muted-foreground leading-relaxed">
              미해당(기본)은 정격 100%. 세 조건을 한꺼번에 깎지 않습니다.
            </p>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-px bg-border rounded overflow-hidden text-xs">
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">적용 정격 (ton)</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">총중량 (ton)</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">여유율</div>
            <div className={`bg-card p-2 text-center font-bold ${result?.equipmentOk ? 'text-green-600' : 'text-red-600'}`}>
              {result?.windStop ? '작업중지' : (result?.equipmentWorkingLoad?.toFixed(1) || '0')}
            </div>
            <div className="bg-card p-2 text-center font-bold">{result?.totalWeightMax?.toFixed(3) || '0'}</div>
            <div className={`bg-card p-2 text-center font-bold ${
              !result?.equipmentOk ? 'text-red-600'
                : (result?.equipmentSafetyFactor ?? 0) >= 1.25 ? 'text-green-600' : 'text-amber-600'
            }`}>
              {result?.windStop ? '-' : (result?.equipmentSafetyFactor?.toFixed(2) || '0')}
            </div>
          </div>
          <p className="text-[9px] text-muted-foreground mt-2 leading-relaxed">
            판정: 적용 정격 ≥ 총중량 (규칙 제146조). 여유율 1.25는 권고이며 법령 필수 아님.
            풍속 5~10m/s는 C-99 인양하중표 20% 감, 10m/s 이상은 C-69·철골 제383조 작업 중지.
          </p>
          </>
            );
          })()}
        </CardContent>
      </Card>

      {/* 6. 줄걸이 안전성 검토 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">6. 줄걸이 안전성 검토</CardTitle>
            {okBadge(result?.slingOk)}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-5 gap-px bg-border rounded overflow-hidden text-xs">
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">재료</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">안전하중 (ton)</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">인양각도</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">1줄 장력 (ton)</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">판정</div>

            <div className="bg-card p-2 text-center">{SLING_MATERIAL_OPTIONS.find(o => o.value === materialType)?.label}</div>
            <div className={`bg-card p-2 text-center font-bold ${result?.slingOk ? 'text-green-600' : 'text-red-600'}`}>
              {result?.slingSafeLoad?.toFixed(1) || '-'}
            </div>
            <div className="bg-card p-2 text-center">{rigging.sling_angle_deg || 60}°</div>
            <div className="bg-card p-2 text-center font-bold">{result?.tensionPerLeg?.toFixed(2) || '-'}</div>
            <div className="bg-card p-2 flex justify-center">{okBadge(result?.slingOk)}</div>
          </div>
          <p className="text-[9px] text-muted-foreground mt-2">
            ※ 1줄 안전하중 ≥ 1줄 장력. T = 줄하중(훅 제외) × (1/sinθ) / 줄수. 각도 계수를 정격에 한 번 더 곱하지 않음.
          </p>
        </CardContent>
      </Card>

      {/* 7. 샤클 안전성 검토 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">7. 샤클 안전성 검토</CardTitle>
            {okBadge(result?.shackleOk)}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-5 gap-px bg-border rounded overflow-hidden text-xs">
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">규격</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">안전하중 (ton)</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">사용 갯수</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">1줄 장력 (ton)</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">판정</div>

            <div className="bg-card p-2 text-center font-bold">{rigging.shackle_inch ? `${rigging.shackle_inch}"` : '-'}</div>
            <div className={`bg-card p-2 text-center font-bold ${result?.shackleOk ? 'text-green-600' : 'text-red-600'}`}>
              {result?.shackleSafeLoad?.toFixed(1) || '-'}
            </div>
            <div className="bg-card p-2 text-center font-bold">{rigging.shackle_qty || 2}</div>
            <div className="bg-card p-2 text-center font-bold">{result?.tensionPerLeg?.toFixed(2) || '-'}</div>
            <div className="bg-card p-2 flex justify-center">{okBadge(result?.shackleOk)}</div>
          </div>
          <p className="text-[9px] text-muted-foreground mt-2">
            ※ 샤클 1개 SWL ≥ 1줄 장력. 사용 갯수로 안전하중을 합산하지 않습니다.
          </p>
        </CardContent>
      </Card>

      {/* 종합 판정 */}
      {result && (
        <Card className={`border-2 ${
          result.overallOk ? 'border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950/20' :
          'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950/20'
        }`}>
          <CardContent className="py-4">
            <div className="flex items-center gap-3 mb-3">
              {result.overallOk ? (
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              ) : (
                <AlertTriangle className="h-6 w-6 text-red-600 animate-pulse" />
              )}
              <div>
                <h3 className="text-sm font-bold">종합 판정: {result.overallOk ? '적합 (O.K)' : '부적합 (N.G)'}</h3>
                <p className="text-[11px] text-muted-foreground">장비 안전율: {result.equipmentSafetyFactor.toFixed(2)}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="flex items-center justify-between p-2 rounded bg-card">
                <span>장비 안전성</span>{okBadge(result.equipmentOk)}
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-card">
                <span>줄걸이 안전성</span>{okBadge(result.slingOk)}
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-card">
                <span>샤클 안전성</span>{okBadge(result.shackleOk)}
              </div>
            </div>
            {result.messages.map((m, i) => <p key={i} className="text-xs mt-2">{m}</p>)}

            {result.recommendations.length > 0 && (
              <div className="mt-3 p-2 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                <div className="flex items-center gap-1 mb-1">
                  <Lightbulb className="h-3.5 w-3.5 text-amber-600" />
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">추천</span>
                </div>
                {result.recommendations.map((r, i) => <p key={i} className="text-xs text-amber-700 dark:text-amber-400">• {r}</p>)}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 비고 */}
      <div className="space-y-1.5">
        <Label className="text-xs">비고</Label>
        <Textarea value={rigging?.notes || ''} onChange={e => onChange('notes', e.target.value)} rows={3} className="text-sm" />
      </div>

      {!readOnly && (
        <Button onClick={onSave} disabled={saving} className="w-full gap-1 pointer-events-auto">
          <Save className="h-3.5 w-3.5" /> 리깅플랜 저장
        </Button>
      )}
    </div>
  );
}
