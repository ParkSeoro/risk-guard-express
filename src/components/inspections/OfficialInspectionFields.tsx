import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  EQUIPMENT_TYPE_OPTIONS,
  officialGradeScale,
  type OfficialFormPayload,
  type OfficialGrade,
  type OfficialInspectionType,
} from "@/lib/legalForms/officialInspectionForms";

export function OfficialHeaderFields({
  type,
  payload,
  disabled,
  onChange,
}: {
  type: OfficialInspectionType;
  payload: OfficialFormPayload;
  disabled?: boolean;
  onChange: (next: OfficialFormPayload) => void;
}) {
  const set = (patch: Partial<OfficialFormPayload>) => onChange({ ...payload, ...patch });
  return (
    <div className="grid gap-3 mb-3 md:grid-cols-2">
      <div>
        <Label className="text-xs">공사명</Label>
        <Input disabled={disabled} value={payload.work_name || ""} onChange={(e) => set({ work_name: e.target.value })} />
      </div>
      <div>
        <Label className="text-xs">점검일</Label>
        <Input type="date" disabled={disabled} value={payload.inspected_date || ""} onChange={(e) => set({ inspected_date: e.target.value })} />
      </div>
      <div>
        <Label className="text-xs">점검자</Label>
        <Input disabled={disabled} value={payload.inspector_name || ""} onChange={(e) => set({ inspector_name: e.target.value })} />
      </div>
      {type === "equipment_sf007" && (
        <div>
          <Label className="text-xs">장비종류</Label>
          <div className="flex flex-wrap gap-2 mt-1">
            {EQUIPMENT_TYPE_OPTIONS.map((opt) => {
              const on = (payload.equipment_types || []).includes(opt);
              return (
                <Button
                  key={opt}
                  type="button"
                  size="sm"
                  variant={on ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() => {
                    const cur = payload.equipment_types || [];
                    set({ equipment_types: on ? cur.filter((x) => x !== opt) : [...cur, opt] });
                  }}
                >
                  {opt}
                </Button>
              );
            })}
          </div>
          {(payload.equipment_types || []).includes("기타") && (
            <Input className="mt-2" disabled={disabled} placeholder="기타 장비명" value={payload.equipment_other || ""} onChange={(e) => set({ equipment_other: e.target.value })} />
          )}
        </div>
      )}
    </div>
  );
}

export function OfficialFooterFields({
  type,
  payload,
  disabled,
  onChange,
}: {
  type: OfficialInspectionType;
  payload: OfficialFormPayload;
  disabled?: boolean;
  onChange: (next: OfficialFormPayload) => void;
}) {
  const set = (patch: Partial<OfficialFormPayload>) => onChange({ ...payload, ...patch });
  if (type === "daily_sf006") {
    return (
      <div className="mt-5 space-y-3">
        <div>
          <Label className="text-xs">지적 사항</Label>
          <Textarea rows={2} disabled={disabled} value={payload.findings || ""} onChange={(e) => set({ findings: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">조치 사항</Label>
          <Textarea rows={2} disabled={disabled} value={payload.measures || ""} onChange={(e) => set({ measures: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">근로자 안전수칙 준수 우수자</Label>
          {(payload.excellence || []).map((row, i) => (
            <div key={i} className="grid grid-cols-3 gap-2 mt-1">
              <Input disabled={disabled} placeholder="소속 업체" value={row.company} onChange={(e) => {
                const next = [...(payload.excellence || [])];
                next[i] = { ...next[i], company: e.target.value };
                set({ excellence: next });
              }} />
              <Input disabled={disabled} placeholder="성함" value={row.name} onChange={(e) => {
                const next = [...(payload.excellence || [])];
                next[i] = { ...next[i], name: e.target.value };
                set({ excellence: next });
              }} />
              <Input disabled={disabled} placeholder="우수 내역" value={row.note} onChange={(e) => {
                const next = [...(payload.excellence || [])];
                next[i] = { ...next[i], note: e.target.value };
                set({ excellence: next });
              }} />
            </div>
          ))}
          {!disabled && (
            <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => set({ excellence: [...(payload.excellence || []), { company: "", name: "", note: "" }] })}>
              행 추가
            </Button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="mt-5 space-y-3">
      <div>
        <Label className="text-xs">점검 및 조치사항</Label>
        <Textarea rows={3} disabled={disabled} value={payload.action_notes || ""} onChange={(e) => set({ action_notes: e.target.value })} />
      </div>
      <div>
        <Label className="text-xs">DIG 서명 (최대 3)</Label>
        <div className="grid grid-cols-3 gap-2 mt-1">
          {(payload.dig_signers || ["", "", ""]).map((v, i) => (
            <Input key={i} disabled={disabled} value={v} onChange={(e) => {
              const next = [...(payload.dig_signers || ["", "", ""])];
              next[i] = e.target.value;
              set({ dig_signers: next });
            }} />
          ))}
        </div>
      </div>
      <div>
        <Label className="text-xs">공사업체 서명 (최대 3)</Label>
        <div className="grid grid-cols-3 gap-2 mt-1">
          {(payload.contractor_signers || ["", "", ""]).map((v, i) => (
            <Input key={i} disabled={disabled} value={v} onChange={(e) => {
              const next = [...(payload.contractor_signers || ["", "", ""])];
              next[i] = e.target.value;
              set({ contractor_signers: next });
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function OfficialGradeButtons({
  type,
  value,
  disabled,
  onPick,
}: {
  type: OfficialInspectionType;
  value: OfficialGrade | null;
  disabled?: boolean;
  onPick: (g: OfficialGrade) => void;
}) {
  const two = officialGradeScale(type) === "two";
  const opts: Array<{ g: OfficialGrade; label: string; variant: "default" | "destructive" | "secondary" | "outline" }> = two
    ? [
        { g: "good", label: "양호", variant: "default" },
        { g: "poor", label: "불량", variant: "destructive" },
      ]
    : [
        { g: "good", label: "양호", variant: "default" },
        { g: "fair", label: "미흡", variant: "secondary" },
        { g: "poor", label: "불량", variant: "destructive" },
        { g: "na", label: "N/A", variant: "outline" },
      ];
  return (
    <div className="flex flex-wrap gap-1">
      {opts.map((o) => (
        <Button
          key={o.g}
          size="sm"
          variant={value === o.g ? o.variant : "outline"}
          className={value === o.g && o.g === "good" ? "bg-success hover:bg-success" : ""}
          disabled={disabled}
          onClick={() => onPick(o.g)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}
