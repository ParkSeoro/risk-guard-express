import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Calculator, ClipboardCheck, AlertTriangle, CheckCircle2, Copy, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  calcCraneLoad, calcExcavationSlope, calcFallProtection, calcConfinedSpaceAtmosphere,
  calcScaffoldLoad, calcVentilation, calcDemolitionZone, calcElectricalApproach,
  SOIL_STANDARD_SLOPE, type CalcResult,
} from '@/lib/workPlanCalculators';

/**
 * 필수 입력 검증 헬퍼.
 * 각 계산기는 자신이 요구하는 법정 기준값(예: 정격하중, 토질, 작업높이 등)을 정의하고,
 * 누락 시 저장(작업방법 추가)을 차단 + 입력 가이드를 즉시 노출합니다.
 */
interface MissingField { label: string; hint: string; legalBasis?: string; }

function MissingGuide({ items }: { items: MissingField[] }) {
  if (items.length === 0) return null;
  return (
    <Alert variant="destructive" className="border-amber-300 bg-amber-50 text-amber-900 [&>svg]:text-amber-600">
      <Info className="h-4 w-4" />
      <AlertTitle className="text-sm font-semibold">필수 법정 기준값이 누락되었습니다 — 저장이 차단됩니다</AlertTitle>
      <AlertDescription className="text-xs space-y-1 mt-1">
        <ul className="list-disc list-inside space-y-0.5">
          {items.map((it, i) => (
            <li key={i}>
              <span className="font-medium">{it.label}</span> — {it.hint}
              {it.legalBasis && <span className="block ml-4 text-[10px] text-amber-700">근거: {it.legalBasis}</span>}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function SaveButton({
  missing, onSave,
}: { missing: MissingField[]; onSave: () => void }) {
  const { toast } = useToast();
  const blocked = missing.length > 0;
  return (
    <Button
      size="sm"
      variant="outline"
      className="gap-1"
      disabled={blocked}
      onClick={() => {
        if (blocked) {
          toast({
            title: '저장 차단',
            description: `${missing[0].label} 등 ${missing.length}개 필수값을 먼저 입력해주세요.`,
            variant: 'destructive',
          });
          return;
        }
        onSave();
      }}
    >
      <Copy className="h-3 w-3" />{blocked ? '필수값 입력 필요' : '계산결과를 작업방법에 추가'}
    </Button>
  );
}

/**
 * 작업계획서 법정 계산 패널.
 * 공종(heavy_lifting / excavation / high_work / confined_space)에 따라 적합한 계산기를 노출하고,
 * 결과를 작업방법(method) 섹션에 자동 삽입할 수 있게 합니다.
 */

interface Props {
  workType: string;
  /** 계산 결과 텍스트를 method 섹션에 추가하기 위한 콜백 */
  onAppendToMethod?: (text: string) => void;
}

function ResultBlock({ result }: { result: CalcResult | null }) {
  if (!result) return null;
  const color =
    result.verdict === 'pass' ? 'bg-emerald-100 text-emerald-700 border-emerald-300' :
    result.verdict === 'warn' ? 'bg-amber-100 text-amber-700 border-amber-300' :
    'bg-rose-100 text-rose-700 border-rose-300';
  const Icon = result.verdict === 'pass' ? CheckCircle2 : AlertTriangle;
  return (
    <div className={`rounded-md border p-3 space-y-2 ${color}`}>
      <div className="flex items-center gap-2 font-medium text-sm">
        <Icon className="h-4 w-4" />{result.conclusion}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {Object.entries(result.breakdown).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <span className="text-muted-foreground">{k}</span>
            <span className="font-medium">{v}</span>
          </div>
        ))}
      </div>
      {result.recommendations && result.recommendations.length > 0 && (
        <div className="pt-1 border-t border-current/20">
          <p className="text-[11px] font-semibold mb-1">권장 조치</p>
          <ul className="list-disc list-inside text-[11px] space-y-0.5">
            {result.recommendations.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground border-t border-current/10 pt-1">법적 근거: {result.legalBasis}</p>
    </div>
  );
}

function resultToText(title: string, r: CalcResult): string {
  const lines = [
    `■ ${title} 계산 결과`,
    `판정: ${r.conclusion}`,
    `계산 내역:`,
    ...Object.entries(r.breakdown).map(([k, v]) => `  - ${k}: ${v}`),
    `법적 근거: ${r.legalBasis}`,
  ];
  if (r.recommendations?.length) {
    lines.push('권장 조치:');
    r.recommendations.forEach((x) => lines.push(`  - ${x}`));
  }
  return lines.join('\n');
}

/* ---------- Crane ---------- */
function CraneCalc({ onAppend }: { onAppend: (t: string) => void }) {
  const { toast } = useToast();
  const [s, setS] = useState({ ratedCapacityTon: 25, loadTon: 10, riggingTon: 0.5, radiusM: 8, windMs: 4 });
  const r = useMemo(() => calcCraneLoad(s), [s]);
  const upd = (k: keyof typeof s, v: string) => setS({ ...s, [k]: Number(v) || 0 });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <div className="space-y-1"><Label className="text-xs">정격하중(t) @반경</Label><Input type="number" value={s.ratedCapacityTon} onChange={e => upd('ratedCapacityTon', e.target.value)} className="h-8" /></div>
        <div className="space-y-1"><Label className="text-xs">작업반경(m)</Label><Input type="number" value={s.radiusM} onChange={e => upd('radiusM', e.target.value)} className="h-8" /></div>
        <div className="space-y-1"><Label className="text-xs">인양물(t)</Label><Input type="number" value={s.loadTon} onChange={e => upd('loadTon', e.target.value)} className="h-8" /></div>
        <div className="space-y-1"><Label className="text-xs">리깅(t)</Label><Input type="number" step="0.1" value={s.riggingTon} onChange={e => upd('riggingTon', e.target.value)} className="h-8" /></div>
        <div className="space-y-1"><Label className="text-xs">풍속(m/s)</Label><Input type="number" step="0.1" value={s.windMs} onChange={e => upd('windMs', e.target.value)} className="h-8" /></div>
      </div>
      <ResultBlock result={r} />
      <Button size="sm" variant="outline" className="gap-1" onClick={() => { onAppend(resultToText('크레인 양중 안전율', r)); toast({ title: '작업방법 섹션에 추가됨' }); }}>
        <Copy className="h-3 w-3" />계산결과를 작업방법에 추가
      </Button>
    </div>
  );
}

/* ---------- Excavation ---------- */
function ExcavationCalc({ onAppend }: { onAppend: (t: string) => void }) {
  const { toast } = useToast();
  const [s, setS] = useState({ soilType: '토사_점토' as keyof typeof SOIL_STANDARD_SLOPE, depthM: 3, actualHorizontal: 1.2 });
  const r = useMemo(() => calcExcavationSlope(s), [s]);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">토질</Label>
          <Select value={s.soilType} onValueChange={(v: any) => setS({ ...s, soilType: v })}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.keys(SOIL_STANDARD_SLOPE).map(k => (
                <SelectItem key={k} value={k}>{k} ({SOIL_STANDARD_SLOPE[k].ratio})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label className="text-xs">굴착 깊이(m)</Label><Input type="number" step="0.1" value={s.depthM} onChange={e => setS({ ...s, depthM: Number(e.target.value) || 0 })} className="h-8" /></div>
        <div className="space-y-1"><Label className="text-xs">실제 수평거리(1m 수직당, m)</Label><Input type="number" step="0.1" value={s.actualHorizontal} onChange={e => setS({ ...s, actualHorizontal: Number(e.target.value) || 0 })} className="h-8" /></div>
      </div>
      <ResultBlock result={r} />
      <Button size="sm" variant="outline" className="gap-1" onClick={() => { onAppend(resultToText('굴착 사면 안전율', r)); toast({ title: '작업방법 섹션에 추가됨' }); }}>
        <Copy className="h-3 w-3" />계산결과를 작업방법에 추가
      </Button>
    </div>
  );
}

/* ---------- Fall Protection ---------- */
function FallCalc({ onAppend }: { onAppend: (t: string) => void }) {
  const { toast } = useToast();
  const [s, setS] = useState({ heightM: 3, hasRailing: true, hasNet: false, hasLifeline: true, anchorageStrengthKgf: 600 });
  const r = useMemo(() => calcFallProtection(s), [s]);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <div className="space-y-1"><Label className="text-xs">작업 높이(m)</Label><Input type="number" step="0.1" value={s.heightM} onChange={e => setS({ ...s, heightM: Number(e.target.value) || 0 })} className="h-8" /></div>
        <div className="space-y-1"><Label className="text-xs">부착설비 강도(kgf)</Label><Input type="number" value={s.anchorageStrengthKgf} onChange={e => setS({ ...s, anchorageStrengthKgf: Number(e.target.value) || 0 })} className="h-8" /></div>
        <div />
        <div className="flex items-center gap-2"><Switch checked={s.hasRailing} onCheckedChange={(v) => setS({ ...s, hasRailing: v })} /><Label className="text-xs">안전난간</Label></div>
        <div className="flex items-center gap-2"><Switch checked={s.hasNet} onCheckedChange={(v) => setS({ ...s, hasNet: v })} /><Label className="text-xs">추락방호망</Label></div>
        <div className="flex items-center gap-2"><Switch checked={s.hasLifeline} onCheckedChange={(v) => setS({ ...s, hasLifeline: v })} /><Label className="text-xs">안전대 부착설비</Label></div>
      </div>
      <ResultBlock result={r} />
      <Button size="sm" variant="outline" className="gap-1" onClick={() => { onAppend(resultToText('추락 방호조치', r)); toast({ title: '작업방법 섹션에 추가됨' }); }}>
        <Copy className="h-3 w-3" />계산결과를 작업방법에 추가
      </Button>
    </div>
  );
}

/* ---------- Confined Space ---------- */
function ConfinedCalc({ onAppend }: { onAppend: (t: string) => void }) {
  const { toast } = useToast();
  const [s, setS] = useState({ oxygenPct: 20.9, coPpm: 5, h2sPpm: 0, lelPct: 0 });
  const r = useMemo(() => calcConfinedSpaceAtmosphere(s), [s]);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="space-y-1"><Label className="text-xs">산소(%)</Label><Input type="number" step="0.1" value={s.oxygenPct} onChange={e => setS({ ...s, oxygenPct: Number(e.target.value) || 0 })} className="h-8" /></div>
        <div className="space-y-1"><Label className="text-xs">CO(ppm)</Label><Input type="number" value={s.coPpm} onChange={e => setS({ ...s, coPpm: Number(e.target.value) || 0 })} className="h-8" /></div>
        <div className="space-y-1"><Label className="text-xs">H2S(ppm)</Label><Input type="number" value={s.h2sPpm} onChange={e => setS({ ...s, h2sPpm: Number(e.target.value) || 0 })} className="h-8" /></div>
        <div className="space-y-1"><Label className="text-xs">LEL(%)</Label><Input type="number" step="0.1" value={s.lelPct} onChange={e => setS({ ...s, lelPct: Number(e.target.value) || 0 })} className="h-8" /></div>
      </div>
      <ResultBlock result={r} />
      <Button size="sm" variant="outline" className="gap-1" onClick={() => { onAppend(resultToText('밀폐공간 가스농도', r)); toast({ title: '작업방법 섹션에 추가됨' }); }}>
        <Copy className="h-3 w-3" />계산결과를 작업방법에 추가
      </Button>
    </div>
  );
}

/* ---------- Scaffold Load ---------- */
function ScaffoldCalc({ onAppend }: { onAppend: (t: string) => void }) {
  const { toast } = useToast();
  const [s, setS] = useState({ areaSqm: 10, workerCount: 4, materialKg: 300, workerWeightKg: 80 });
  const r = useMemo(() => calcScaffoldLoad(s), [s]);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="space-y-1"><Label className="text-xs">발판 면적(㎡)</Label><Input type="number" step="0.1" value={s.areaSqm} onChange={e => setS({ ...s, areaSqm: Number(e.target.value) || 0 })} className="h-8" /></div>
        <div className="space-y-1"><Label className="text-xs">작업원 수</Label><Input type="number" value={s.workerCount} onChange={e => setS({ ...s, workerCount: Number(e.target.value) || 0 })} className="h-8" /></div>
        <div className="space-y-1"><Label className="text-xs">1인+공구(kgf)</Label><Input type="number" value={s.workerWeightKg} onChange={e => setS({ ...s, workerWeightKg: Number(e.target.value) || 0 })} className="h-8" /></div>
        <div className="space-y-1"><Label className="text-xs">자재(kgf)</Label><Input type="number" value={s.materialKg} onChange={e => setS({ ...s, materialKg: Number(e.target.value) || 0 })} className="h-8" /></div>
      </div>
      <ResultBlock result={r} />
      <Button size="sm" variant="outline" className="gap-1" onClick={() => { onAppend(resultToText('비계 적재하중', r)); toast({ title: '작업방법 섹션에 추가됨' }); }}>
        <Copy className="h-3 w-3" />계산결과를 작업방법에 추가
      </Button>
    </div>
  );
}

/* ---------- Ventilation ---------- */
function VentilationCalc({ onAppend }: { onAppend: (t: string) => void }) {
  const { toast } = useToast();
  const [s, setS] = useState({ workerCount: 5, perPerson: 3, machineCmm: 0, suppliedCmm: 0 });
  const r = useMemo(() => calcVentilation(s), [s]);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="space-y-1"><Label className="text-xs">작업원 수</Label><Input type="number" value={s.workerCount} onChange={e => setS({ ...s, workerCount: Number(e.target.value) || 0 })} className="h-8" /></div>
        <div className="space-y-1"><Label className="text-xs">1인당(㎥/min)</Label><Input type="number" step="0.1" value={s.perPerson} onChange={e => setS({ ...s, perPerson: Number(e.target.value) || 0 })} className="h-8" /></div>
        <div className="space-y-1"><Label className="text-xs">장비풍량(㎥/min)</Label><Input type="number" value={s.machineCmm} onChange={e => setS({ ...s, machineCmm: Number(e.target.value) || 0 })} className="h-8" /></div>
        <div className="space-y-1"><Label className="text-xs">공급풍량(㎥/min)</Label><Input type="number" value={s.suppliedCmm} onChange={e => setS({ ...s, suppliedCmm: Number(e.target.value) || 0 })} className="h-8" /></div>
      </div>
      <ResultBlock result={r} />
      <Button size="sm" variant="outline" className="gap-1" onClick={() => { onAppend(resultToText('환기 풍량', r)); toast({ title: '작업방법 섹션에 추가됨' }); }}>
        <Copy className="h-3 w-3" />계산결과를 작업방법에 추가
      </Button>
    </div>
  );
}

/* ---------- Demolition ---------- */
function DemolitionCalc({ onAppend }: { onAppend: (t: string) => void }) {
  const { toast } = useToast();
  const [s, setS] = useState({ structureHeightM: 12, barrierDistanceM: 20, adjacentDistanceM: 25, method: '기계식' as const });
  const r = useMemo(() => calcDemolitionZone(s), [s]);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="space-y-1"><Label className="text-xs">구조물 높이(m)</Label><Input type="number" step="0.1" value={s.structureHeightM} onChange={e => setS({ ...s, structureHeightM: Number(e.target.value) || 0 })} className="h-8" /></div>
        <div className="space-y-1">
          <Label className="text-xs">해체 공법</Label>
          <Select value={s.method} onValueChange={(v: any) => setS({ ...s, method: v })}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['기계식', '발파', '압쇄', '전도'].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label className="text-xs">방호선 이격(m)</Label><Input type="number" step="0.1" value={s.barrierDistanceM} onChange={e => setS({ ...s, barrierDistanceM: Number(e.target.value) || 0 })} className="h-8" /></div>
        <div className="space-y-1"><Label className="text-xs">인접시설 이격(m)</Label><Input type="number" step="0.1" value={s.adjacentDistanceM} onChange={e => setS({ ...s, adjacentDistanceM: Number(e.target.value) || 0 })} className="h-8" /></div>
      </div>
      <ResultBlock result={r} />
      <Button size="sm" variant="outline" className="gap-1" onClick={() => { onAppend(resultToText('해체 영향권', r)); toast({ title: '작업방법 섹션에 추가됨' }); }}>
        <Copy className="h-3 w-3" />계산결과를 작업방법에 추가
      </Button>
    </div>
  );
}

/* ---------- Electrical ---------- */
function ElectricalCalc({ onAppend }: { onAppend: (t: string) => void }) {
  const { toast } = useToast();
  const [s, setS] = useState({ voltageKv: 22.9, actualCm: 100, insulated: false });
  const r = useMemo(() => calcElectricalApproach(s), [s]);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <div className="space-y-1"><Label className="text-xs">전압(kV)</Label><Input type="number" step="0.1" value={s.voltageKv} onChange={e => setS({ ...s, voltageKv: Number(e.target.value) || 0 })} className="h-8" /></div>
        <div className="space-y-1"><Label className="text-xs">실제 이격(cm)</Label><Input type="number" value={s.actualCm} onChange={e => setS({ ...s, actualCm: Number(e.target.value) || 0 })} className="h-8" /></div>
        <div className="flex items-center gap-2"><Switch checked={s.insulated} onCheckedChange={(v) => setS({ ...s, insulated: v })} /><Label className="text-xs">절연용 보호구 사용</Label></div>
      </div>
      <ResultBlock result={r} />
      <Button size="sm" variant="outline" className="gap-1" onClick={() => { onAppend(resultToText('전기 접근한계거리', r)); toast({ title: '작업방법 섹션에 추가됨' }); }}>
        <Copy className="h-3 w-3" />계산결과를 작업방법에 추가
      </Button>
    </div>
  );
}

export default function LegalCalculatorPanel({ workType, onAppendToMethod }: Props) {
  const map: Record<string, { label: string; Comp: (p: { onAppend: (t: string) => void }) => JSX.Element }[]> = {
    heavy_lifting: [{ label: '크레인 양중 안전율', Comp: CraneCalc }],
    steel: [{ label: '크레인 양중 안전율', Comp: CraneCalc }, { label: '추락 방호조치', Comp: FallCalc }],
    excavation: [{ label: '굴착 사면 안전율', Comp: ExcavationCalc }],
    high_work: [{ label: '추락 방호조치', Comp: FallCalc }],
    scaffold: [{ label: '비계 적재하중', Comp: ScaffoldCalc }, { label: '추락 방호조치', Comp: FallCalc }],
    confined_space: [{ label: '밀폐공간 가스농도', Comp: ConfinedCalc }, { label: '환기 풍량', Comp: VentilationCalc }],
    tunnel: [{ label: '환기 풍량', Comp: VentilationCalc }, { label: '밀폐공간 가스농도', Comp: ConfinedCalc }],
    demolition: [{ label: '해체 영향권', Comp: DemolitionCalc }],
    electrical: [{ label: '전기 접근한계거리', Comp: ElectricalCalc }],
  };
  const list = map[workType] || [];
  const append = (t: string) => onAppendToMethod?.(t);

  if (list.length === 0) {
    return (
      <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">
        이 공종은 자동 계산이 제공되지 않습니다. 위 작업내용 섹션에 직접 기재해주세요.
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Calculator className="h-3.5 w-3.5" />
        계산값은 산업안전보건기준에 관한 규칙 및 KOSHA GUIDE를 따릅니다. 계산결과는 작업방법 섹션에 자동으로 추가할 수 있습니다.
      </div>
      {list.map(({ label, Comp }, i) => (
        <Card key={i}>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-primary" />{label}<Badge variant="outline" className="text-[10px]">법정</Badge></CardTitle></CardHeader>
          <CardContent><Comp onAppend={append} /></CardContent>
        </Card>
      ))}
      <Separator />
    </div>
  );
}
