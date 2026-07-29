import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import {
  AccessRules,
  ZONE_CATEGORY_OPTIONS,
  ZONE_COLOR_OPTIONS,
  ZoneRuleType,
  ZoneColor,
  DEFAULT_ZONE_CATEGORY,
  buildAccessRules,
  parseAccessRules,
  zoneCategorySchema,
  type ZoneCategory,
} from "@/lib/tracking/accessRules";
import { jobCategoryEntries } from "@/lib/jobCategories";
import type { DrawnShape } from "@/components/geofence/LeafletDrawControl";
import { formatGpsPreview } from "@/lib/tracking/imageSpaceGeo";

export type ZoneDraftPayload = {
  name: string;
  zone_category: ZoneCategory;
  zone_color: ZoneColor | string;
  rule_type: ZoneRuleType;
  access_rules: AccessRules;
  shape: DrawnShape | null;
  /** When set, update existing zone instead of insert */
  zoneId?: string;
};

export type ZoneEditSeed = {
  id: string;
  name: string;
  zone_category?: string | null;
  zone_color?: string | null;
  rule_type?: string | null;
  access_rules?: unknown;
};

type CompanyOpt = { id: string; name: string };

type Props = {
  open: boolean;
  shape: DrawnShape | null;
  editZone?: ZoneEditSeed | null;
  companies: CompanyOpt[];
  defaultColor?: string;
  saving?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: ZoneDraftPayload) => void | Promise<void>;
};

export default function ZoneAccessRulesDialog({
  open,
  shape,
  editZone,
  companies,
  defaultColor = "#ef4444",
  saving,
  onOpenChange,
  onSave,
}: Props) {
  const [name, setName] = useState("위험구역");
  const [category, setCategory] = useState<ZoneCategory>(DEFAULT_ZONE_CATEGORY);
  const [ruleType, setRuleType] = useState<ZoneRuleType>("ALLOW");
  const [zoneColor, setZoneColor] = useState<string>(defaultColor);
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [jobTypes, setJobTypes] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    if (editZone) {
      const parsed = parseAccessRules(editZone.access_rules);
      const rt =
        editZone.rule_type === "ALLOW" || editZone.rule_type === "DENY"
          ? editZone.rule_type
          : parsed.rule_type;
      const catParsed = zoneCategorySchema.safeParse(editZone.zone_category);
      setName(editZone.name || "위험구역");
      setCategory(catParsed.success ? catParsed.data : DEFAULT_ZONE_CATEGORY);
      setRuleType(rt);
      setZoneColor(editZone.zone_color || defaultColor);
      setCompanyIds(parsed.company_ids || []);
      setJobTypes(parsed.job_types || []);
      return;
    }
    setName("위험구역");
    setCategory(DEFAULT_ZONE_CATEGORY);
    setRuleType("ALLOW");
    setZoneColor(defaultColor);
    setCompanyIds([]);
    setJobTypes([]);
  }, [open, shape, editZone, defaultColor]);

  const toggleCompany = (id: string, on: boolean) => {
    setCompanyIds((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
  };
  const toggleJob = (job: string, on: boolean) => {
    setJobTypes((prev) => (on ? [...new Set([...prev, job])] : prev.filter((x) => x !== job)));
  };

  const hasTargets = companyIds.length > 0 || jobTypes.length > 0;
  const canSave = (!!shape || !!editZone) && hasTargets;

  const handleSave = async () => {
    if (!canSave) return;
    const catParsed = zoneCategorySchema.safeParse(category);
    if (!catParsed.success) return;
    const access_rules = buildAccessRules(ruleType, companyIds, jobTypes);
    await onSave({
      name: name.trim() || "위험구역",
      zone_category: catParsed.data,
      zone_color: zoneColor,
      rule_type: ruleType,
      access_rules,
      shape: shape,
      zoneId: editZone?.id,
    });
  };

  const shapeHint =
    shape?.kind === "circle"
      ? `원형 · 반경 ${shape.radius_m}m`
      : shape?.kind === "polygon"
        ? `다각형 · ${shape.latlngs.length}점`
        : editZone
          ? "기존 도형 유지 · 통제 조건만 수정"
          : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editZone ? "구역 통제 조건 수정" : "위험구역 속성 · 출입 통제"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {shapeHint && (
            <p className="text-xs text-muted-foreground rounded-md bg-muted/50 px-2 py-1.5">
              {shapeHint}
            </p>
          )}

          <div className="space-y-1.5">
            <Label>구역명</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 고소작업 추락위험구역" />
          </div>

          <div className="space-y-1.5">
            <Label>구역 유형</Label>
            <Select
              value={category}
              onValueChange={(v) => {
                const parsed = zoneCategorySchema.safeParse(v);
                if (parsed.success) setCategory(parsed.data);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ZONE_CATEGORY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>구역 색상</Label>
            <div className="flex gap-2">
              {ZONE_COLOR_OPTIONS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setZoneColor(c.value)}
                  className={`h-9 flex-1 rounded-md border text-xs font-medium transition ${
                    zoneColor === c.value ? "ring-2 ring-offset-1 ring-primary border-primary" : ""
                  }`}
                  style={{ backgroundColor: `${c.value}22`, borderColor: c.value }}
                >
                  <span className="inline-block h-2.5 w-2.5 rounded-full mr-1.5 align-middle" style={{ background: c.value }} />
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>통제 방식</Label>
            <div className="space-y-2 rounded-md border p-2.5">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="rule_type"
                  className="mt-1"
                  checked={ruleType === "ALLOW"}
                  onChange={() => setRuleType("ALLOW")}
                />
                <span>
                  <span className="font-medium">지정 대상만 출입 허용 (Whitelist)</span>
                  <span className="block text-[11px] text-muted-foreground">
                    선택한 업체·직종만 출입 가능 · 그 외 진입 시 알람
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="rule_type"
                  className="mt-1"
                  checked={ruleType === "DENY"}
                  onChange={() => setRuleType("DENY")}
                />
                <span>
                  <span className="font-medium">지정 대상 출입 전면 통제 (Blacklist)</span>
                  <span className="block text-[11px] text-muted-foreground">
                    선택한 업체·직종 진입 시 알람 · 그 외는 허용
                  </span>
                </span>
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <Label>대상 지정 — 업체</Label>
            <div className="space-y-1 max-h-32 overflow-auto rounded-md border p-2">
              {companies.length === 0 && (
                <p className="text-xs text-destructive">등록된 프로젝트 업체가 없습니다.</p>
              )}
              {companies.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-xs cursor-pointer py-0.5">
                  <Checkbox
                    checked={companyIds.includes(c.id)}
                    onCheckedChange={(v) => toggleCompany(c.id, !!v)}
                  />
                  <span className="truncate">{c.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>대상 지정 — 직종</Label>
            <div className="space-y-2 max-h-40 overflow-auto rounded-md border p-2">
              {jobCategoryEntries().map(([cat, jobs]) => (
                <div key={cat} className="space-y-1">
                  <p className="text-[10px] font-semibold text-muted-foreground">{cat}</p>
                  {jobs.map((job) => (
                    <label key={job} className="flex items-center gap-2 text-xs cursor-pointer py-0.5">
                      <Checkbox
                        checked={jobTypes.includes(job)}
                        onCheckedChange={(v) => toggleJob(job, !!v)}
                      />
                      <span>{job}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {!hasTargets && (
            <p className="text-[10px] text-amber-600">업체 또는 직종을 1개 이상 선택하세요.</p>
          )}

          {shape && (
            <p className="text-[10px] leading-relaxed text-muted-foreground break-all border-t pt-3">
              {formatGpsPreview(shape)}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={!!saving}>
            취소
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={!!saving || !canSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            {editZone ? "조건 저장" : "구역 저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
