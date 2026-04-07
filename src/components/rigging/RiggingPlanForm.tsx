import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Calculator, CheckCircle2, AlertTriangle, XCircle, Save } from 'lucide-react';
import {
  calculateFullRigging,
  getWireBreakingLoad,
  getShackleSafeLoad,
  mmToInch,
  WIND_SPEED_FACTORS,
  TERMINAL_METHOD_EFFICIENCY,
  SLING_ANGLE_FACTOR,
  type RiggingInput,
  type RiggingResult,
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
    const input: RiggingInput = {
      equipmentName: rigging.equipment_name || rigging.crane_model || '',
      ratedCapacity: numVal(rigging.rated_capacity) || numVal(rigging.crane_capacity),
      boomLength: numVal(rigging.boom_length),
      workingRadius: numVal(rigging.working_radius),
      liftingCapacity: numVal(rigging.crane_capacity) || numVal(rigging.rated_capacity),
      outriggerDistance: numVal(rigging.outrigger_distance),
      wireDiameterMm: numVal(rigging.wire_diameter_mm),
      slingCount: numVal(rigging.sling_count) || 2,
      slingMethod: rigging.sling_method || '',
      slingStrandCount: numVal(rigging.sling_strand_count) || 1,
      slingAngleDeg: numVal(rigging.sling_angle_deg) || 60,
      wireTerminalMethod: rigging.wire_terminal_method || '탐블(24mm 이하)',
      wireSafetyCoefficient: numVal(rigging.wire_safety_coefficient) || 5,
      wireLiftCount: numVal(rigging.wire_lift_count) || 5,
      shackleDiameterMm: numVal(rigging.shackle_diameter_mm),
      shackleAngleDeg: numVal(rigging.shackle_angle_deg) || 45,
      shackleCount: numVal(rigging.shackle_count) || 0.7,
      shackleQty: numVal(rigging.shackle_qty) || 2,
      loadWeight: numVal(rigging.load_weight),
      hookWeight: numVal(rigging.hook_weight),
      shackleWeightVal: numVal(rigging.shackle_weight_val),
      slingRiggingWeight: numVal(rigging.sling_rigging_weight),
      loadWeightMin: numVal(rigging.load_weight_min),
      hookWeightMin: numVal(rigging.hook_weight_min),
      shackleWeightMin: numVal(rigging.shackle_weight_min),
      slingRiggingWeightMin: numVal(rigging.sling_rigging_weight_min),
      windSpeedGrade: rigging.wind_speed_grade || '0~5',
      windSpeedFactor: numVal(rigging.wind_speed_factor) || 1,
      boomRotationFactor: numVal(rigging.boom_rotation_factor) || 0.8,
      groundInspectionFactor: numVal(rigging.ground_inspection_factor) || 0.8,
      loadProtrusionFactor: numVal(rigging.load_protrusion_factor) || 0.8,
      travelLoadFactor: numVal(rigging.travel_load_factor) || 1,
      safetyFactorPassenger: numVal(rigging.safety_factor_passenger) || 10,
      safetyFactorCargo: numVal(rigging.safety_factor_cargo) || 5,
    };
    const r = calculateFullRigging(input);
    setResult(r);

    // Auto-update computed fields
    onChange('total_weight_max', r.totalWeightMax);
    onChange('total_weight_min', r.totalWeightMin);
    onChange('equipment_working_load', r.equipmentWorkingLoad);
    onChange('equipment_ok', r.equipmentOk ? 'O.K' : 'N.G');
    onChange('sling_working_load', r.slingWorkingLoad);
    onChange('sling_ok', r.slingOk ? 'O.K' : 'N.G');
    onChange('shackle_working_load', r.shackleWorkingLoad);
    onChange('shackle_ok', r.shackleOk ? 'O.K' : 'N.G');
    onChange('wire_breaking_load', r.wireBreakingLoad);
    onChange('wire_safe_load', r.wireSafeLoad);
    onChange('safety_factor', r.safetyFactor);
    onChange('calculated_utilization', r.totalWeightMax > 0 ? (r.totalWeightMax / r.equipmentWorkingLoad) * 100 : 0);
  }, [rigging]);

  useEffect(() => { recalc(); }, [
    rigging?.load_weight, rigging?.hook_weight, rigging?.shackle_weight_val, rigging?.sling_rigging_weight,
    rigging?.load_weight_min, rigging?.hook_weight_min, rigging?.shackle_weight_min, rigging?.sling_rigging_weight_min,
    rigging?.crane_capacity, rigging?.rated_capacity, rigging?.working_radius, rigging?.boom_length,
    rigging?.wire_diameter_mm, rigging?.sling_count, rigging?.sling_angle_deg, rigging?.wire_safety_coefficient,
    rigging?.wind_speed_factor, rigging?.boom_rotation_factor, rigging?.ground_inspection_factor,
    rigging?.load_protrusion_factor, rigging?.shackle_diameter_mm, rigging?.shackle_qty, rigging?.shackle_angle_deg,
    rigging?.wire_terminal_method, rigging?.outrigger_distance,
  ]);

  // Auto-set wire breaking load on diameter change
  useEffect(() => {
    if (rigging?.wire_diameter_mm > 0) {
      const bl = getWireBreakingLoad(numVal(rigging.wire_diameter_mm));
      if (bl > 0) onChange('wire_breaking_load', bl);
      onChange('wire_diameter_inch', parseFloat(mmToInch(numVal(rigging.wire_diameter_mm)).toFixed(2)));
    }
  }, [rigging?.wire_diameter_mm]);

  // Auto-set shackle safe load on diameter change
  useEffect(() => {
    if (rigging?.shackle_diameter_mm > 0) {
      const sl = getShackleSafeLoad(numVal(rigging.shackle_diameter_mm));
      if (sl > 0) onChange('shackle_safe_load', sl);
    }
  }, [rigging?.shackle_diameter_mm]);

  const field = (label: string, key: string, type: string = 'number', opts?: { unit?: string; disabled?: boolean; highlight?: boolean; className?: string }) => (
    <div className={`space-y-1 ${opts?.className || ''}`}>
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
      {/* Header: 안전계수 프로그램 적용 */}
      <Card className="bg-muted/30">
        <CardContent className="py-3 px-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">안전계수 프로그램 적용</span>
            <div className="flex gap-4">
              <span>근로자탑승인 경우: <strong>{rigging.safety_factor_passenger || 10}</strong></span>
              <span>화물의 하중달기인 경우: <strong>{rigging.safety_factor_cargo || 5}</strong></span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 1. 공사개요 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">1. 공사개요</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            {field('작업 내용', 'load_description', 'text')}
            {field('작업 장소', 'outrigger_setup', 'text')}
            {field('작업 기간', 'notes', 'text')}
            {field('작업지휘자', 'lifting_method', 'text')}
          </div>
        </CardContent>
      </Card>

      {/* 2. 양중기 제원 및 줄걸이기구 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">2. 양중기 제원 및 줄걸이기구</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 크레인 제원 */}
          <div className="grid grid-cols-3 gap-px bg-border rounded overflow-hidden">
            <div className="bg-card p-2 col-span-3 bg-blue-50 dark:bg-blue-950/20">
              <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-400">크레인 (아웃리거식)</span>
            </div>
            <div className="bg-card p-2">{field('장비 명', 'equipment_name', 'text', { unit: '' })}</div>
            <div className="bg-card p-2">{field('정격하중', 'rated_capacity', 'number', { unit: 'ton' })}</div>
            <div className="bg-card p-2">{field('크레인 기종', 'crane_model', 'text')}</div>
            <div className="bg-card p-2">{field('붐 길이', 'boom_length', 'number', { unit: 'm' })}</div>
            <div className="bg-card p-2">{field('작업반경', 'working_radius', 'number', { unit: 'm' })}</div>
            <div className="bg-card p-2">{field('인양능력', 'crane_capacity', 'number', { unit: 'ton', highlight: true })}</div>
            <div className="bg-card p-2">{field('아웃리거 거리', 'outrigger_distance', 'number', { unit: 'm' })}</div>
          </div>

          <Separator />

          {/* 줄걸이 - 와이어로프 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground">줄걸이</h4>
              <div className="grid grid-cols-2 gap-2">
                {field('인양각도', 'sling_angle_deg', 'number', { unit: '°' })}
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
                {field('인양물 양중 수', 'wire_lift_count', 'number')}
                {field('줄걸이 수/방법', 'sling_count', 'number')}
                {field('꼬기 매달기 수', 'sling_strand_count', 'number')}
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground">재료 - 와이어로프</h4>
              <div className="grid grid-cols-2 gap-2">
                {field('규격', 'wire_diameter_mm', 'number', { unit: 'mm' })}
                {field('규격 (inch)', 'wire_diameter_inch', 'number', { unit: 'inch', disabled: true })}
                {field('절단하중', 'wire_breaking_load', 'number', { unit: 'ton', disabled: true, highlight: true })}
                {field('안전하중', 'wire_safe_load', 'number', { unit: 'ton', disabled: true })}
              </div>
            </div>
          </div>

          <Separator />

          {/* 체결장구 - 샤클 */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">체결 장구 (샤클)</h4>
            <div className="grid grid-cols-4 gap-2">
              {field('규격', 'shackle_diameter_mm', 'number', { unit: 'mm' })}
              {field('안전하중', 'shackle_safe_load', 'number', { unit: 'ton', disabled: true, highlight: true })}
              {field('인양각도', 'shackle_angle_deg', 'number', { unit: '°' })}
              {field('사용 갯수', 'shackle_qty', 'number')}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3. 중량물 제원 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">3. 중량물 제원</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-6">
            {/* 최대 */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-red-600">중량물 1 (최대)</h4>
              {field('품명', 'load_name_max', 'text')}
              <div className="grid grid-cols-2 gap-2">
                {field('인양물', 'load_weight', 'number', { unit: 'ton' })}
                {field('HOOK', 'hook_weight', 'number', { unit: 'ton' })}
                {field('샤클', 'shackle_weight_val', 'number', { unit: 'ton' })}
                {field('슬링/로프/와이어', 'sling_rigging_weight', 'number', { unit: 'ton' })}
              </div>
              <div className="flex items-center gap-2 pt-1 border-t">
                <span className="text-xs font-bold">총중량(톤):</span>
                <span className="text-sm font-bold text-red-600">{result?.totalWeightMax?.toFixed(3) || '0'}</span>
                <span className="text-[10px] text-muted-foreground">톤</span>
              </div>
            </div>

            {/* 최소 */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-blue-600">중량물 2 (최소)</h4>
              {field('품명', 'load_name_min', 'text')}
              <div className="grid grid-cols-2 gap-2">
                {field('인양물', 'load_weight_min', 'number', { unit: 'ton' })}
                {field('HOOK', 'hook_weight_min', 'number', { unit: 'ton' })}
                {field('샤클', 'shackle_weight_min', 'number', { unit: 'ton' })}
                {field('슬링/로프/와이어', 'sling_rigging_weight_min', 'number', { unit: 'ton' })}
              </div>
              <div className="flex items-center gap-2 pt-1 border-t">
                <span className="text-xs font-bold">총중량(톤):</span>
                <span className="text-sm font-bold text-blue-600">{result?.totalWeightMin?.toFixed(3) || '0'}</span>
                <span className="text-[10px] text-muted-foreground">톤</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 4. 장비 안전성 검토 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">4. 장비 안전성 검토</CardTitle>
            {okBadge(result?.equipmentOk)}
          </div>
          <p className="text-[10px] text-muted-foreground">(장비 제원표 별도첨부)</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-5 gap-px bg-border rounded overflow-hidden text-xs">
            {/* Header */}
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">풍속 (m/s)</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">봉대 회전</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">지반검사</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">주행(인양물돌기)</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">인양 가능유무</div>

            {/* Wind Speed */}
            <div className="bg-card p-2">
              <Select value={rigging.wind_speed_grade || '0~5'} onValueChange={v => {
                const wf = WIND_SPEED_FACTORS.find(w => w.range === v);
                onChange('wind_speed_grade', v);
                onChange('wind_speed_factor', wf?.factor ?? 1);
              }}>
                <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WIND_SPEED_FACTORS.map(w => (
                    <SelectItem key={w.range} value={w.range} className="text-xs">
                      {w.range} m/s ({w.label})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-center mt-1 text-[10px] text-muted-foreground">계수: {rigging.wind_speed_factor || 1}</div>
            </div>

            {/* Boom Rotation */}
            <div className="bg-card p-2">
              <Input type="number" value={rigging.boom_rotation_factor ?? 0.8}
                onChange={e => onChange('boom_rotation_factor', e.target.value)}
                className="h-7 text-[10px] text-center" step="0.1" />
            </div>

            {/* Ground */}
            <div className="bg-card p-2">
              <Input type="number" value={rigging.ground_inspection_factor ?? 0.8}
                onChange={e => onChange('ground_inspection_factor', e.target.value)}
                className="h-7 text-[10px] text-center" step="0.1" />
            </div>

            {/* Travel */}
            <div className="bg-card p-2">
              <Input type="number" value={rigging.travel_load_factor ?? 1}
                onChange={e => onChange('travel_load_factor', e.target.value)}
                className="h-7 text-[10px] text-center" />
            </div>

            {/* Result */}
            <div className="bg-card p-2 flex flex-col items-center justify-center">
              {okBadge(result?.equipmentOk)}
            </div>
          </div>

          {/* Equipment calculation detail */}
          <div className="mt-3 grid grid-cols-4 gap-px bg-border rounded overflow-hidden text-xs">
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">구분</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">작업하중(ton)</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">인양물(ton)</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">인양 가능유무</div>

            <div className="bg-card p-2 text-center">크레인 (아웃리거식)</div>
            <div className={`bg-card p-2 text-center font-bold ${result?.equipmentOk ? 'text-green-600' : 'text-red-600'}`}>
              {result?.equipmentWorkingLoad?.toFixed(1) || '0'}
            </div>
            <div className="bg-card p-2 text-center font-bold">{result?.totalWeightMax?.toFixed(3) || '0'}</div>
            <div className="bg-card p-2 flex justify-center">{okBadge(result?.equipmentOk)}</div>
          </div>
        </CardContent>
      </Card>

      {/* 5. 줄걸이 안전성 검토 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">5. 줄걸이 안전성 검토</CardTitle>
            {okBadge(result?.slingOk)}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-6 gap-px bg-border rounded overflow-hidden text-xs">
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">구분</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">규격(mm)</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">절단하중(ton)</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">인양각도</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">작업하중(ton)</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">인양 가능유무</div>

            <div className="bg-card p-2 text-center">와이어로프</div>
            <div className="bg-card p-2 text-center font-bold">{rigging.wire_diameter_mm || '-'}</div>
            <div className="bg-card p-2 text-center font-bold text-yellow-600">{result?.wireBreakingLoad?.toFixed(1) || '-'}</div>
            <div className="bg-card p-2 text-center">{rigging.sling_angle_deg || 60}°</div>
            <div className={`bg-card p-2 text-center font-bold ${result?.slingOk ? 'text-green-600' : 'text-red-600'}`}>
              {result?.slingWorkingLoad?.toFixed(1) || '-'}
            </div>
            <div className="bg-card p-2 flex justify-center">{okBadge(result?.slingOk)}</div>
          </div>
          <p className="text-[9px] text-muted-foreground mt-2">
            ※ 와이어로프 안전하중 : (절단하중÷안전계수({rigging.wire_safety_coefficient || 5})) × 줄걸이수({rigging.sling_count || 2}) ÷ 줄걸이각도계수
          </p>
        </CardContent>
      </Card>

      {/* 6. 샤클 안전성 검토 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">6. 샤클 안전성 검토</CardTitle>
            {okBadge(result?.shackleOk)}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-px bg-border rounded overflow-hidden text-xs">
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">규격(mm)</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">안전하중(ton)</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">인양각도 및 개수</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">샤클 갯수</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">작업하중(ton)</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">인양물(ton)</div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-2 text-center font-medium">인양 가능유무</div>

            <div className="bg-card p-2 text-center font-bold">{rigging.shackle_diameter_mm || '-'}</div>
            <div className="bg-card p-2 text-center font-bold text-yellow-600">{result?.shackleSafeLoad?.toFixed(1) || '-'}</div>
            <div className="bg-card p-2 text-center">{rigging.shackle_angle_deg || 45}° / {rigging.shackle_count || 0.7}</div>
            <div className="bg-card p-2 text-center font-bold">{rigging.shackle_qty || 2}</div>
            <div className={`bg-card p-2 text-center font-bold ${result?.shackleOk ? 'text-green-600' : 'text-red-600'}`}>
              {result?.shackleWorkingLoad?.toFixed(1) || '-'}
            </div>
            <div className="bg-card p-2 text-center font-bold">{result?.totalWeightMax?.toFixed(3) || '-'}</div>
            <div className="bg-card p-2 flex justify-center">{okBadge(result?.shackleOk)}</div>
          </div>
          <p className="text-[9px] text-muted-foreground mt-2">
            ※ 슬링벨트 안전하중 : 안전하중표 참조 (안전계수 6 적용, "S" 마크경우 7 적용)
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
                <h3 className="text-sm font-bold">종합 판정: {result.overallOk ? '적합' : '부적합'}</h3>
                <p className="text-[11px] text-muted-foreground">장비 안전율: {result.safetyFactor.toFixed(2)}</p>
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
            {result.messages.map((m, i) => (
              <p key={i} className="text-xs mt-2">{m}</p>
            ))}
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
