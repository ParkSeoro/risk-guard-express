import { useState, useEffect } from 'react';
import { ImeControlledInput as Input, ImeControlledTextarea as Textarea } from '@/components/ImeControlled';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { methodStepsForPrint } from '@/lib/workPlanMethodSection';
import {
  HEAVY_LIFT_LEGAL_HAZARDS,
  normalizeRiskToLegalSlots,
  usesFixedLegalRisk,
  validateHeavyLiftLegalRisk,
  type LegalRiskRow,
} from '@/lib/workPlanLegalRisk';

interface StructuredSectionFormProps {
  sectionKey: string;
  workType: string;
  value: string; // JSON string or plain text
  onChange: (value: string) => void;
}

// Parse stored value - could be JSON or plain text
function parseValue(val: string): any {
  if (!val) return null;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

function OverviewForm({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  const v = data || { work_name: '', work_date: '', work_location: '', work_content: '', supervisor: '', workers_count: '' };
  const set = (k: string, val: string) => onChange({ ...v, [k]: val });

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label className="text-xs">작업명 *</Label>
        <Input value={v.work_name} onChange={e => set('work_name', e.target.value)} placeholder="예: 1공구 철골 양중작업" className="h-9" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">작업일시</Label>
        <Input type="date" value={v.work_date} onChange={e => set('work_date', e.target.value)} className="h-9" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">작업위치 *</Label>
        <Input value={v.work_location} onChange={e => set('work_location', e.target.value)} placeholder="예: A동 3층" className="h-9" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">현장감독자</Label>
        <Input value={v.supervisor} onChange={e => set('supervisor', e.target.value)} placeholder="이름/직책" className="h-9" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">투입인원</Label>
        <Input type="number" value={v.workers_count} onChange={e => set('workers_count', e.target.value)} placeholder="예: 8" className="h-9" />
      </div>
      <div className="col-span-2 space-y-1">
        <Label className="text-xs">작업내용 *</Label>
        <Textarea value={v.work_content} onChange={e => set('work_content', e.target.value)} placeholder="작업 상세 내용을 기재하세요" rows={3} className="text-sm" />
      </div>
    </div>
  );
}

function EquipmentForm({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  const items = Array.isArray(data) ? data : [{ name: '', model: '', capacity: '', manufacturer: '', inspection_date: '' }];
  const update = (idx: number, k: string, val: string) => {
    const next = items.map((item: any, i: number) => i === idx ? { ...item, [k]: val } : item);
    onChange(next);
  };
  const add = () => onChange([...items, { name: '', model: '', capacity: '', manufacturer: '', inspection_date: '' }]);
  const remove = (idx: number) => onChange(items.filter((_: any, i: number) => i !== idx));

  return (
    <div className="space-y-3">
      {items.map((item: any, idx: number) => (
        <div key={idx} className="grid grid-cols-5 gap-2 p-3 border rounded-lg bg-muted/20 relative">
          {items.length > 1 && (
            <Button variant="ghost" size="icon" className="absolute -top-2 -right-2 h-6 w-6" onClick={() => remove(idx)}>
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          )}
          <div className="space-y-1">
            <Label className="text-[10px]">장비명 *</Label>
            <Input value={item.name} onChange={e => update(idx, 'name', e.target.value)} placeholder="크레인" className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">모델명</Label>
            <Input value={item.model} onChange={e => update(idx, 'model', e.target.value)} placeholder="LTM 1100" className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">정격하중 (t)</Label>
            <Input type="number" value={item.capacity} onChange={e => update(idx, 'capacity', e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">제조사</Label>
            <Input value={item.manufacturer} onChange={e => update(idx, 'manufacturer', e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">검사일</Label>
            <Input type="date" value={item.inspection_date} onChange={e => update(idx, 'inspection_date', e.target.value)} className="h-8 text-xs" />
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add} className="gap-1 text-xs">
        <Plus className="h-3 w-3" /> 장비 추가
      </Button>
    </div>
  );
}

function MethodForm({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  // Recover corrupted `{ "0": step, notes }` objects from legal-calculator append bug.
  const steps = (() => {
    if (Array.isArray(data) && data.length) return data;
    const recovered = methodStepsForPrint(
      data && typeof data === "object" ? JSON.stringify(data) : "[]",
    );
    if (recovered.length) return recovered;
    return [{ order: 1, description: "", safety_measure: "" }];
  })();
  const update = (idx: number, k: string, val: string) => {
    const next = steps.map((s: any, i: number) => i === idx ? { ...s, [k]: val } : s);
    onChange(next);
  };
  const add = () => onChange([...steps, { order: steps.length + 1, description: '', safety_measure: '' }]);
  const remove = (idx: number) => onChange(steps.filter((_: any, i: number) => i !== idx).map((s: any, i: number) => ({ ...s, order: i + 1 })));

  return (
    <div className="space-y-2">
      {steps.map((step: any, idx: number) => (
        <div key={idx} className="flex gap-2 items-start p-2 border rounded bg-muted/20">
          <span className="text-xs font-bold text-muted-foreground mt-2 w-6 shrink-0">{step.order}.</span>
          <div className="flex-1 space-y-1">
            <Input value={step.description} onChange={e => update(idx, 'description', e.target.value)} placeholder="작업 단계 설명 *" className="h-8 text-xs" />
            <Input value={step.safety_measure} onChange={e => update(idx, 'safety_measure', e.target.value)} placeholder="안전조치 사항" className="h-8 text-xs" />
          </div>
          {steps.length > 1 && (
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => remove(idx)}>
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          )}
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add} className="gap-1 text-xs">
        <Plus className="h-3 w-3" /> 단계 추가
      </Button>
    </div>
  );
}

function FixedLegalRiskForm({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  const items = normalizeRiskToLegalSlots(data);
  const update = (idx: number, k: keyof LegalRiskRow, val: string) => {
    const next = items.map((item, i) => (i === idx ? { ...item, [k]: val } : item));
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        산안규칙 별표 4(중량물) 필수 다섯 칸입니다. 칸을 지우거나 이름을 바꿀 수 없습니다. AI 작성으로 대책을 채울 수 있습니다.
      </p>
      {items.map((item, idx) => {
        const meta = HEAVY_LIFT_LEGAL_HAZARDS[idx];
        return (
          <div key={item.key} className="grid grid-cols-[88px_1fr_1fr_72px] gap-2 p-2 border rounded bg-muted/20 items-start">
            <div className="space-y-1">
              <Label className="text-[10px]">별표 4</Label>
              <p className="h-8 flex items-center text-xs font-semibold">{item.hazard}</p>
              <p className="text-[9px] text-muted-foreground leading-tight">{meta?.label}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">발생상황</Label>
              <Input value={item.situation} onChange={e => update(idx, 'situation', e.target.value)} placeholder="이 현장에서 어떻게 일어나는지" className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">안전대책 *</Label>
              <Input value={item.measure} onChange={e => update(idx, 'measure', e.target.value)} placeholder="실행 가능한 구체 조치" className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">위험도</Label>
              <Select value={item.severity} onValueChange={v => update(idx, 'severity', v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="상">상</SelectItem>
                  <SelectItem value="중">중</SelectItem>
                  <SelectItem value="하">하</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RiskForm({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  const items = Array.isArray(data) ? data : [{ hazard: '', situation: '', measure: '', severity: '중' }];
  const update = (idx: number, k: string, val: string) => {
    const next = items.map((item: any, i: number) => i === idx ? { ...item, [k]: val } : item);
    onChange(next);
  };
  const add = () => onChange([...items, { hazard: '', situation: '', measure: '', severity: '중' }]);
  const remove = (idx: number) => onChange(items.filter((_: any, i: number) => i !== idx));

  return (
    <div className="space-y-2">
      {items.map((item: any, idx: number) => (
        <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_80px_32px] gap-2 p-2 border rounded bg-muted/20 items-start">
          <div className="space-y-1">
            <Label className="text-[10px]">위험요인 *</Label>
            <Input value={item.hazard} onChange={e => update(idx, 'hazard', e.target.value)} placeholder="원인 + 사고결과" className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">발생상황</Label>
            <Input value={item.situation} onChange={e => update(idx, 'situation', e.target.value)} placeholder="구체적 상황" className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">안전대책 *</Label>
            <Input value={item.measure} onChange={e => update(idx, 'measure', e.target.value)} placeholder="구체적 조치" className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">위험도</Label>
            <Select value={item.severity} onValueChange={v => update(idx, 'severity', v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="상">상</SelectItem>
                <SelectItem value="중">중</SelectItem>
                <SelectItem value="하">하</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {items.length > 1 && (
            <Button variant="ghost" size="icon" className="h-7 w-7 mt-4" onClick={() => remove(idx)}>
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          )}
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add} className="gap-1 text-xs">
        <Plus className="h-3 w-3" /> 위험요인 추가
      </Button>
    </div>
  );
}

function SignalForm({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  const v = data || { signal_person: '', signal_method: '', radio_channel: '', hand_signals: '', emergency_signal: '' };
  const set = (k: string, val: string) => onChange({ ...v, [k]: val });

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label className="text-xs">신호수 성명/자격</Label>
        <Input value={v.signal_person} onChange={e => set('signal_person', e.target.value)} placeholder="홍길동 / 신호수 자격" className="h-9" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">신호방법</Label>
        <Select value={v.signal_method} onValueChange={val => set('signal_method', val)}>
          <SelectTrigger className="h-9"><SelectValue placeholder="선택" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="무전기">무전기</SelectItem>
            <SelectItem value="수신호">수신호</SelectItem>
            <SelectItem value="호루라기">호루라기</SelectItem>
            <SelectItem value="혼합">혼합 (무전기+수신호)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">무전기 채널</Label>
        <Input value={v.radio_channel} onChange={e => set('radio_channel', e.target.value)} placeholder="예: CH-5" className="h-9" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">비상정지 신호</Label>
        <Input value={v.emergency_signal} onChange={e => set('emergency_signal', e.target.value)} placeholder="예: 호루라기 3회" className="h-9" />
      </div>
      <div className="col-span-2 space-y-1">
        <Label className="text-xs">수신호 약속</Label>
        <Textarea value={v.hand_signals} onChange={e => set('hand_signals', e.target.value)} placeholder="인양, 정지, 선회 등 수신호 약속을 기재" rows={2} className="text-sm" />
      </div>
    </div>
  );
}

function EmergencyForm({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  const v = data || { emergency_contact: '', evacuation_route: '', first_aid: '', hospital: '', assembly_point: '', reporting_procedure: '' };
  const set = (k: string, val: string) => onChange({ ...v, [k]: val });

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label className="text-xs">비상연락처 *</Label>
        <Input value={v.emergency_contact} onChange={e => set('emergency_contact', e.target.value)} placeholder="119, 현장소장 010-xxxx" className="h-9" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">인근 병원</Label>
        <Input value={v.hospital} onChange={e => set('hospital', e.target.value)} placeholder="○○병원 (차량 10분)" className="h-9" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">대피경로</Label>
        <Input value={v.evacuation_route} onChange={e => set('evacuation_route', e.target.value)} placeholder="서측 비상계단 → 주차장" className="h-9" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">집결장소</Label>
        <Input value={v.assembly_point} onChange={e => set('assembly_point', e.target.value)} placeholder="정문 주차장" className="h-9" />
      </div>
      <div className="col-span-2 space-y-1">
        <Label className="text-xs">응급처치 계획</Label>
        <Textarea value={v.first_aid} onChange={e => set('first_aid', e.target.value)} placeholder="응급처치 장비 위치, 담당자 등" rows={2} className="text-sm" />
      </div>
      <div className="col-span-2 space-y-1">
        <Label className="text-xs">보고 체계</Label>
        <Textarea value={v.reporting_procedure} onChange={e => set('reporting_procedure', e.target.value)} placeholder="사고 발생 → 현장소장 보고 → 119 신고 → 본사 보고" rows={2} className="text-sm" />
      </div>
    </div>
  );
}

function ChecklistForm({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  const items = Array.isArray(data) ? data : [{ item: '', checked: false }];
  const update = (idx: number, k: string, val: any) => {
    const next = items.map((item: any, i: number) => i === idx ? { ...item, [k]: val } : item);
    onChange(next);
  };
  const add = () => onChange([...items, { item: '', checked: false }]);
  const remove = (idx: number) => onChange(items.filter((_: any, i: number) => i !== idx));

  return (
    <div className="space-y-2">
      {items.map((item: any, idx: number) => (
        <div key={idx} className="flex gap-2 items-center">
          <Input value={item.item} onChange={e => update(idx, 'item', e.target.value)} placeholder="점검 항목" className="h-8 text-xs flex-1" />
          {items.length > 1 && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(idx)}>
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          )}
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add} className="gap-1 text-xs">
        <Plus className="h-3 w-3" /> 항목 추가
      </Button>
    </div>
  );
}

// Generic text form for less common sections (geology, ventilation, monitoring, etc.)
function GenericStructuredForm({ data, onChange, fields }: { data: any; onChange: (d: any) => void; fields: { key: string; label: string; type?: string; rows?: number }[] }) {
  const v = data || {};
  const set = (k: string, val: string) => onChange({ ...v, [k]: val });

  return (
    <div className="grid grid-cols-2 gap-3">
      {fields.map(f => (
        <div key={f.key} className={`space-y-1 ${f.type === 'textarea' ? 'col-span-2' : ''}`}>
          <Label className="text-xs">{f.label}</Label>
          {f.type === 'textarea' ? (
            <Textarea value={v[f.key] || ''} onChange={e => set(f.key, e.target.value)} rows={f.rows || 3} className="text-sm" />
          ) : (
            <Input value={v[f.key] || ''} onChange={e => set(f.key, e.target.value)} className="h-9" />
          )}
        </div>
      ))}
    </div>
  );
}

const GEOLOGY_FIELDS = [
  { key: 'soil_type', label: '지반 종류' },
  { key: 'groundwater', label: '지하수위 (m)' },
  { key: 'rock_class', label: '암반등급' },
  { key: 'gas_present', label: '가스 존재 여부' },
  { key: 'summary', label: '조사 결과 요약', type: 'textarea' as const, rows: 3 },
];

const VENTILATION_FIELDS = [
  { key: 'method', label: '환기 방식' },
  { key: 'air_volume', label: '필요 풍량 (㎥/min)' },
  { key: 'fan_spec', label: '환풍기 사양' },
  { key: 'gas_monitoring', label: '가스 측정 계획', type: 'textarea' as const, rows: 2 },
];

const SHORING_FIELDS = [
  { key: 'type', label: '흙막이 종류' },
  { key: 'depth', label: '설치 깊이 (m)' },
  { key: 'method', label: '설치 방법', type: 'textarea' as const, rows: 2 },
  { key: 'monitoring', label: '계측 계획', type: 'textarea' as const, rows: 2 },
];

const STRUCTURE_FIELDS = [
  { key: 'type', label: '구조물 종류' },
  { key: 'spec', label: '규격' },
  { key: 'height', label: '높이/단수' },
  { key: 'detail', label: '구조 상세', type: 'textarea' as const, rows: 3 },
];

const ATMOSPHERE_FIELDS = [
  { key: 'oxygen', label: '산소 농도 기준 (%)' },
  { key: 'gas_types', label: '유해가스 종류' },
  { key: 'measurement_freq', label: '측정 빈도' },
  { key: 'equipment', label: '측정 장비' },
  { key: 'plan', label: '측정 계획', type: 'textarea' as const, rows: 2 },
];

const RESCUE_FIELDS = [
  { key: 'equipment', label: '구조 장비' },
  { key: 'team', label: '구조팀 편성' },
  { key: 'procedure', label: '구조 절차', type: 'textarea' as const, rows: 3 },
];

const SAFETY_ZONE_FIELDS = [
  { key: 'distance', label: '안전 거리 (m)' },
  { key: 'boundary', label: '경계 구역' },
  { key: 'alarm', label: '경보 체계', type: 'textarea' as const, rows: 2 },
];

const SURVEY_FIELDS = [
  { key: 'asbestos', label: '석면 조사 결과' },
  { key: 'structural', label: '구조 안전 진단' },
  { key: 'utilities', label: '매설물 확인' },
  { key: 'summary', label: '조사 요약', type: 'textarea' as const, rows: 3 },
];

const MONITORING_FIELDS = [
  { key: 'convergence', label: '내공변위' },
  { key: 'crown', label: '천단침하' },
  { key: 'surface', label: '지표침하' },
  { key: 'frequency', label: '계측 빈도' },
  { key: 'criteria', label: '관리 기준값', type: 'textarea' as const, rows: 2 },
];

const ROUTE_FIELDS = [
  { key: 'path', label: '운행 경로' },
  { key: 'ground', label: '지반·경사 상태' },
  { key: 'sight', label: '시야·교차 구간' },
  { key: 'notes', label: '상세', type: 'textarea' as const, rows: 3 },
];

const COMMANDER_FIELDS = [
  { key: 'name', label: '작업지휘자 성명' },
  { key: 'qualification', label: '자격·직책' },
  { key: 'placement', label: '배치 위치' },
  { key: 'duties', label: '임무', type: 'textarea' as const, rows: 3 },
];

const CONTACT_FIELDS = [
  { key: 'method', label: '연락 방법' },
  { key: 'signal', label: '신호 방법' },
  { key: 'radio', label: '무전/채널' },
  { key: 'notes', label: '상세', type: 'textarea' as const, rows: 2 },
];

const SPOIL_FIELDS = [
  { key: 'method', label: '반출 방법' },
  { key: 'route', label: '반출 경로' },
  { key: 'equipment', label: '운반 장비' },
  { key: 'notes', label: '상세', type: 'textarea' as const, rows: 2 },
];

const CREW_FIELDS = [
  { key: 'composition', label: '인원 구성' },
  { key: 'roles', label: '역할 범위', type: 'textarea' as const, rows: 3 },
];

const ASSEMBLE_FIELDS = [
  { key: 'kind', label: '작업 구분 (설치/상승/해체)' },
  { key: 'sequence', label: '순서 및 안전조치', type: 'textarea' as const, rows: 5 },
];

const SUPPORT_FIELDS = [
  { key: 'foundation', label: '기초' },
  { key: 'wall_tie', label: '월타이/지지' },
  { key: 'detail', label: '지지방법 상세', type: 'textarea' as const, rows: 3 },
];

const TOOLS_FIELDS = [
  { key: 'tools', label: '작업도구·장비' },
  { key: 'temporary', label: '가설설비' },
  { key: 'guard', label: '방호설비', type: 'textarea' as const, rows: 2 },
];

const ISOLATION_FIELDS = [
  { key: 'lockout', label: '차단(LOTO)' },
  { key: 'purge', label: '퍼지·치환' },
  { key: 'verify', label: '잔류 확인', type: 'textarea' as const, rows: 3 },
];

const APPROACH_FIELDS = [
  { key: 'voltage', label: '전압 (kV)' },
  { key: 'limit_cm', label: '접근한계 (cm)' },
  { key: 'ppe', label: '절연 보호구' },
  { key: 'notes', label: '상세', type: 'textarea' as const, rows: 2 },
];

const CONSULT_FIELDS = [
  { key: 'party', label: '운행관계자' },
  { key: 'window', label: '차단·협의 시간' },
  { key: 'contact', label: '연락 수단' },
  { key: 'notes', label: '협의 내용', type: 'textarea' as const, rows: 3 },
];

const STAFFING_FIELDS = [
  { key: 'count', label: '작업 인원' },
  { key: 'volume', label: '작업량' },
  { key: 'sequence', label: '작업순서', type: 'textarea' as const, rows: 3 },
];

// Map section keys to specific structured form types
const SECTION_FORM_MAP: Record<string, string> = {
  overview: 'overview',
  equipment: 'equipment',
  method: 'method',
  risk: 'risk',
  signal: 'signal',
  emergency: 'emergency',
  inspection: 'checklist',
  geology: 'geology',
  ventilation: 'ventilation',
  shoring: 'shoring',
  structure: 'structure',
  atmosphere: 'atmosphere',
  rescue: 'rescue',
  safety_zone: 'safety_zone',
  survey: 'survey',
  monitoring: 'monitoring',
  route: 'route',
  commander: 'commander',
  contact: 'contact',
  spoil: 'spoil',
  crew: 'crew',
  assemble: 'assemble',
  support: 'support',
  tools: 'tools',
  isolation: 'isolation',
  approach: 'approach',
  consult: 'consult',
  staffing: 'staffing',
};

export default function StructuredSectionForm({ sectionKey, workType, value, onChange }: StructuredSectionFormProps) {
  const parsed = parseValue(value);
  const formType = SECTION_FORM_MAP[sectionKey];

  const handleChange = (data: any) => {
    onChange(JSON.stringify(data));
  };

  switch (formType) {
    case 'overview':
      return <OverviewForm data={parsed} onChange={handleChange} />;
    case 'equipment':
      return <EquipmentForm data={parsed} onChange={handleChange} />;
    case 'method':
      return (
        <MethodForm
          data={methodStepsForPrint(value)}
          onChange={handleChange}
        />
      );
    case 'risk':
      return usesFixedLegalRisk(workType)
        ? <FixedLegalRiskForm data={parsed} onChange={handleChange} />
        : <RiskForm data={parsed} onChange={handleChange} />;
    case 'signal':
      return <SignalForm data={parsed} onChange={handleChange} />;
    case 'emergency':
      return <EmergencyForm data={parsed} onChange={handleChange} />;
    case 'checklist':
      return <ChecklistForm data={parsed} onChange={handleChange} />;
    case 'geology':
      return <GenericStructuredForm data={parsed} onChange={handleChange} fields={GEOLOGY_FIELDS} />;
    case 'ventilation':
      return <GenericStructuredForm data={parsed} onChange={handleChange} fields={VENTILATION_FIELDS} />;
    case 'shoring':
      return <GenericStructuredForm data={parsed} onChange={handleChange} fields={SHORING_FIELDS} />;
    case 'structure':
      return <GenericStructuredForm data={parsed} onChange={handleChange} fields={STRUCTURE_FIELDS} />;
    case 'atmosphere':
      return <GenericStructuredForm data={parsed} onChange={handleChange} fields={ATMOSPHERE_FIELDS} />;
    case 'rescue':
      return <GenericStructuredForm data={parsed} onChange={handleChange} fields={RESCUE_FIELDS} />;
    case 'safety_zone':
      return <GenericStructuredForm data={parsed} onChange={handleChange} fields={SAFETY_ZONE_FIELDS} />;
    case 'survey':
      return <GenericStructuredForm data={parsed} onChange={handleChange} fields={SURVEY_FIELDS} />;
    case 'monitoring':
      return <GenericStructuredForm data={parsed} onChange={handleChange} fields={MONITORING_FIELDS} />;
    case 'route':
      return <GenericStructuredForm data={parsed} onChange={handleChange} fields={ROUTE_FIELDS} />;
    case 'commander':
      return <GenericStructuredForm data={parsed} onChange={handleChange} fields={COMMANDER_FIELDS} />;
    case 'contact':
      return <GenericStructuredForm data={parsed} onChange={handleChange} fields={CONTACT_FIELDS} />;
    case 'spoil':
      return <GenericStructuredForm data={parsed} onChange={handleChange} fields={SPOIL_FIELDS} />;
    case 'crew':
      return <GenericStructuredForm data={parsed} onChange={handleChange} fields={CREW_FIELDS} />;
    case 'assemble':
      return <GenericStructuredForm data={parsed} onChange={handleChange} fields={ASSEMBLE_FIELDS} />;
    case 'support':
      return <GenericStructuredForm data={parsed} onChange={handleChange} fields={SUPPORT_FIELDS} />;
    case 'tools':
      return <GenericStructuredForm data={parsed} onChange={handleChange} fields={TOOLS_FIELDS} />;
    case 'isolation':
      return <GenericStructuredForm data={parsed} onChange={handleChange} fields={ISOLATION_FIELDS} />;
    case 'approach':
      return <GenericStructuredForm data={parsed} onChange={handleChange} fields={APPROACH_FIELDS} />;
    case 'consult':
      return <GenericStructuredForm data={parsed} onChange={handleChange} fields={CONSULT_FIELDS} />;
    case 'staffing':
      return <GenericStructuredForm data={parsed} onChange={handleChange} fields={STAFFING_FIELDS} />;
    default:
      // Fallback: plain textarea for unknown sections
      return (
        <Textarea
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          rows={6}
          className="text-sm"
          placeholder="내용을 입력하세요"
        />
      );
  }
}

// Validation: check required fields for a section
export function validateSection(sectionKey: string, value: string, workType?: string): string[] {
  const errors: string[] = [];
  const parsed = parseValue(value);
  if (!parsed && !value?.trim()) {
    errors.push('내용을 입력해주세요.');
    return errors;
  }

  switch (sectionKey) {
    case 'overview':
      if (!parsed?.work_name) errors.push('작업명은 필수입니다.');
      if (!parsed?.work_location) errors.push('작업위치는 필수입니다.');
      if (!parsed?.work_content) errors.push('작업내용은 필수입니다.');
      break;
    case 'equipment':
      if (Array.isArray(parsed) && parsed.some((e: any) => !e.name)) errors.push('장비명은 필수입니다.');
      break;
    case 'risk':
      if (usesFixedLegalRisk(workType)) {
        errors.push(...validateHeavyLiftLegalRisk(value));
      } else if (Array.isArray(parsed) && parsed.some((e: any) => !e.hazard || !e.measure)) {
        errors.push('위험요인과 안전대책은 필수입니다.');
      }
      break;
    case 'emergency':
      if (!parsed?.emergency_contact) errors.push('비상연락처는 필수입니다.');
      break;
    case 'commander':
      if (workType === 'excavation' || workType === 'vehicle_cargo') {
        if (!parsed?.name) errors.push('작업지휘자 성명은 필수입니다.');
      }
      break;
  }
  return errors;
}
