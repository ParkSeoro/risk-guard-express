import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Calculator, CheckCircle2, AlertTriangle, XCircle, Save, Lightbulb } from 'lucide-react';
import {
  calculateFullRigging,
  getWireBreakingLoad,
  getShackleSafeLoadByInch,
  getSlingBeltRatedLoad,
  getChainSlingLoad,
  mmToInch,
  WIND_SPEED_FACTORS,
  TERMINAL_METHOD_EFFICIENCY,
  SLING_MATERIAL_OPTIONS,
  SLING_BELT_BY_COLOR,
  ROUND_SLING_OPTIONS,
  CHAIN_SLING_LOAD,
  SHACKLE_INCH_LOAD,
  type RiggingInput,
  type RiggingResult,
  type SlingMaterialType,
} from '@/lib/riggingCalculator';

interface RiggingPlanFormProps {
  rigging: any;
  onChange: (field: string, value: any) => void;
  onSave: () => void;
  saving: boolean;
}

const numVal = (v: any) => Number(v) || 0;

export default function RiggingPlanForm({ rigging, onChange, onSave, saving }: RiggingPlanFormProps) {
  const [result, setResult] = useState<RiggingResult | null>(null);

  const recalc = useCallback(() => {
    if (!rigging) return;
    const materialType = (rigging.sling_material_type || 'wire_rope') as SlingMaterialType;
    const input: RiggingInput = {
      equipmentName: rigging.equipment_name || rigging.crane_model || '',
      ratedCapacity: numVal(rigging.rated_capacity) || numVal(rigging.crane_capacity),
      boomLength: numVal(rigging.boom_length),
      workingRadius: numVal(rigging.working_radius),
      liftingCapacity: numVal(rigging.crane_capacity) || numVal(rigging.rated_capacity),
      outriggerDistance: numVal(rigging.outrigger_distance),
      slingMaterialType: materialType,
      wireDiameterMm: numVal(rigging.wire_diameter_mm),
      slingCount: numVal(rigging.sling_count) || 2,
      slingAngleDeg: numVal(rigging.sling_angle_deg) || 60,
      wireTerminalMethod: rigging.wire_terminal_method || '탐블(24mm 이하)',
      wireSafetyCoefficient: numVal(rigging.wire_safety_coefficient) || 5,
      slingBeltColor: rigging.sling_belt_color || '',
      slingBeltRatedLoad: numVal(rigging.sling_belt_rated_load),
      roundSlingRatedLoad: numVal(rigging.round_sling_rated_load),
      chainDiameterMm: numVal(rigging.chain_diameter_mm),
      chainLegCount: numVal(rigging.chain_leg_count) || 4,
      shackleInch: rigging.shackle_inch || '',
      shackleQty: numVal(rigging.shackle_qty) || 2,
      loadWeight: numVal(rigging.load_weight),
      hookWeight: numVal(rigging.hook_weight),
      shackleWeightVal: numVal(rigging.shackle_weight_val),
      slingRiggingWeight: numVal(rigging.sling_rigging_weight),
      loadWeightMin: numVal(rigging.load_weight_min),
      hookWeightMin: numVal(rigging.hook_weight_min),
      shackleWeightMin: numVal(rigging.shackle_weight_min),
      slingRiggingWeightMin: numVal(rigging.sling_rigging_weight_min),
      windSpeedFactor: numVal(rigging.wind_speed_factor) || 1,
      boomRotationFactor: numVal(rigging.boom_rotation_factor) || 0.8,
      groundInspectionFactor: numVal(rigging.ground_inspection_factor) || 0.8,
      loadProtrusionFactor: numVal(rigging.load_protrusion_factor) || 0.8,
    };
    const r = calculateFullRigging(input);
    setResult(r);

    onChange('total_weight_max', r.totalWeightMax);
    onChange('total_weight_min', r.totalWeightMin);
    onChange('equipment_working_load', r.equipmentWorkingLoad);
    onChange('equipment_ok', r.equipmentOk ? 'O.K' : 'N.G');
    onChange('sling_working_load', r.slingSafeLoad);
    onChange('sling_ok', r.slingOk ? 'O.K' : 'N.G');
    onChange('shackle_working_load', r.shackleSafeLoad);
    onChange('shackle_ok', r.shackleOk ? 'O.K' : 'N.G');
    onChange('wire_breaking_load', r.wireBreakingLoad);
    onChange('wire_safe_load', r.wireSafeLoad);
    onChange('safety_factor', r.equipmentSafetyFactor);
    onChange('sling_safe_load', r.slingSafeLoad);
    onChange('tension_per_leg', r.tensionPerLeg);
    onChange('calculated_utilization', r.totalWeightMax > 0 && r.equipmentWorkingLoad > 0 ? (r.totalWeightMax / r.equipmentWorkingLoad) * 100 : 0);
  }, [rigging]);

  // Recalc on any relevant field change
  useEffect(() => { recalc(); }, [
    rigging?.load_weight, rigging?.hook_weight, rigging?.shackle_weight_val, rigging?.sling_rigging_weight,
    rigging?.load_weight_min, rigging?.hook_weight_min, rigging?.shackle_weight_min, rigging?.sling_rigging_weight_min,
    rigging?.crane_capacity, rigging?.rated_capacity, rigging?.working_radius, rigging?.boom_length,
    rigging?.wire_diameter_mm, rigging?.sling_count, rigging?.sling_angle_deg, rigging?.wire_safety_coefficient,
    rigging?.wind_speed_factor, rigging?.boom_rotation_factor, rigging?.ground_inspection_factor,
    rigging?.load_protrusion_factor, rigging?.shackle_inch, rigging?.shackle_qty,
    rigging?.wire_terminal_method, rigging?.outrigger_distance,
    rigging?.sling_material_type, rigging?.sling_belt_color, rigging?.sling_belt_rated_load,
    rigging?.round_sling_rated_load, rigging?.chain_diameter_mm, rigging?.chain_leg_count,
  ]);

  // Auto-set wire breaking load
  useEffect(() => {
    if (rigging?.wire_diameter_mm > 0 && rigging?.sling_material_type === 'wire_rope') {
      const bl = getWireBreakingLoad(numVal(rigging.wire_diameter_mm));
      if (bl > 0) onChange('wire_breaking_load', bl);
      onChange('wire_diameter_inch', parseFloat(mmToInch(numVal(rigging.wire_diameter_mm)).toFixed(2)));
    }
  }, [rigging?.wire_diameter_mm]);

  // Auto-set sling belt rated load on color change
  useEffect(() => {
    if (rigging?.sling_belt_color && rigging?.sling_material_type === 'sling_belt') {
      const rl = getSlingBeltRatedLoad(rigging.sling_belt_color);
      if (rl > 0) onChange('sling_belt_rated_load', rl);
    }
  }, [rigging?.sling_belt_color]);

  // Auto-set chain load
  useEffect(() => {
    if (rigging?.chain_diameter_mm > 0 && rigging?.sling_material_type === 'chain_sling') {
      const cl = getChainSlingLoad(numVal(rigging.chain_diameter_mm));
      if (cl > 0) onChange('sling_capacity', cl);
    }
  }, [rigging?.chain_diameter_mm]);

  // Auto-set shackle safe load on inch change
  useEffect(() => {
    if (rigging?.shackle_inch) {
      const sl = getShackleSafeLoadByInch(rigging.shackle_inch);
      if (sl > 0) onChange('shackle_safe_load', sl);
    }
  }, [rigging?.shackle_inch]);

  const materialType = (rigging?.sling_material_type || 'wire_rope') as SlingMaterialType;

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
    <div className="space-y-4">
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

      {/* 2. 양중기 제원 */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">2. 양중기 제원</CardTitle></CardHeader>
        <CardContent className="space-y-4">
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

      {/* 3. 줄걸이 재료 선택 및 제원 */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">3. 줄걸이 재료 및 제원</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {/* Material type selector */}
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
            {/* 공통 줄걸이 설정 */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground">줄걸이 공통</h4>
              <div className="grid grid-cols-2 gap-2">
                {field('인양각도', 'sling_angle_deg', 'number', { unit: '°' })}
                {field('줄걸이 수', 'sling_count', 'number')}
              </div>
            </div>

            {/* Material-specific inputs */}
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
                    <Label className="text-[11px] text-muted-foreground">색상 (정격하중 자동)</Label>
                    <Select value={rigging.sling_belt_color || ''} onValueChange={v => {
                      onChange('sling_belt_color', v);
                      const rl = getSlingBeltRatedLoad(v);
                      onChange('sling_belt_rated_load', rl);
                    }}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="색상 선택" /></SelectTrigger>
                      <SelectContent>
                        {SLING_BELT_BY_COLOR.map(s => (
                          <SelectItem key={s.color} value={s.color} className="text-xs">
                            <span className="flex items-center gap-2">
                              <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: s.color === 'purple' ? '#9b59b6' : s.color === 'brown' ? '#8B4513' : s.color }} />
                              {s.label} ({s.ratedLoad}톤)
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {field('정격하중', 'sling_belt_rated_load', 'number', { unit: 'ton', disabled: true, highlight: true })}
                    {field('폭', 'sling_belt_width_mm', 'number', { unit: 'mm' })}
                  </div>
                </div>
              )}

              {materialType === 'round_sling' && (
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">정격하중 (톤)</Label>
                  <Select value={String(rigging.round_sling_rated_load || '')} onValueChange={v => onChange('round_sling_rated_load', Number(v))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="톤수 선택" /></SelectTrigger>
                    <SelectContent>
                      {ROUND_SLING_OPTIONS.map(t => (
                        <SelectItem key={t} value={String(t)} className="text-xs">{t}톤</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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

          {/* 체결장구 - 샤클 (인치 기준) */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">체결 장구 (샤클)</h4>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">규격 (inch)</Label>
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
          {/* 장력 표시 */}
          {result && result.tensionPerLeg > 0 && (
            <div className="mt-3 p-2 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
              <p className="text-xs font-semibold">1줄당 장력 (T): <span className="text-amber-700 dark:text-amber-400 text-sm">{result.tensionPerLeg.toFixed(2)} 톤</span></p>
              <p className="text-[10px] text-muted-foreground">T = 총중량 / (줄수({rigging.sling_count || 2}) × cos({rigging.sling_angle_deg || 60}°))</p>
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
          <div className="grid grid-cols-5 gap-px bg-border rounded overflow-hidden text-xs">
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">풍속 (m/s)</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">봉대 회전</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">지반검사</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">주행(인양물돌기)</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">판정</div>

            <div className="bg-card p-2">
              <Select value={rigging.wind_speed_grade || '0~5'} onValueChange={v => {
                const wf = WIND_SPEED_FACTORS.find(w => w.range === v);
                onChange('wind_speed_grade', v);
                onChange('wind_speed_factor', wf?.factor ?? 1);
              }}>
                <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WIND_SPEED_FACTORS.map(w => (
                    <SelectItem key={w.range} value={w.range} className="text-xs">{w.range} m/s</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="bg-card p-2">
              <Input type="number" value={rigging.boom_rotation_factor ?? 0.8} onChange={e => onChange('boom_rotation_factor', e.target.value)} className="h-7 text-[10px] text-center" step="0.1" />
            </div>
            <div className="bg-card p-2">
              <Input type="number" value={rigging.ground_inspection_factor ?? 0.8} onChange={e => onChange('ground_inspection_factor', e.target.value)} className="h-7 text-[10px] text-center" step="0.1" />
            </div>
            <div className="bg-card p-2">
              <Input type="number" value={rigging.load_protrusion_factor ?? 0.8} onChange={e => onChange('load_protrusion_factor', e.target.value)} className="h-7 text-[10px] text-center" step="0.1" />
            </div>
            <div className="bg-card p-2 flex flex-col items-center justify-center">
              {okBadge(result?.equipmentOk)}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-px bg-border rounded overflow-hidden text-xs">
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">작업하중 (ton)</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">총중량 (ton)</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">안전율</div>
            <div className={`bg-card p-2 text-center font-bold ${result?.equipmentOk ? 'text-green-600' : 'text-red-600'}`}>
              {result?.equipmentWorkingLoad?.toFixed(1) || '0'}
            </div>
            <div className="bg-card p-2 text-center font-bold">{result?.totalWeightMax?.toFixed(3) || '0'}</div>
            <div className={`bg-card p-2 text-center font-bold ${(result?.equipmentSafetyFactor ?? 0) >= 1.25 ? 'text-green-600' : 'text-red-600'}`}>
              {result?.equipmentSafetyFactor?.toFixed(2) || '0'}
            </div>
          </div>
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
            ※ 안전하중 ≥ 1줄당 장력이면 O.K | 장력 T = 총중량 / (줄수 × cosθ)
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

            {/* 추천 */}
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

      <Button onClick={onSave} disabled={saving} className="w-full gap-1">
        <Save className="h-3.5 w-3.5" /> 리깅플랜 저장
      </Button>
    </div>
  );
}
