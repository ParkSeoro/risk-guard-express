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
  AccessRuleMode,
  AccessRules,
  DEFAULT_ACCESS_RULES,
  JOB_TYPE_OPTIONS,
  ZONE_CATEGORY_OPTIONS,
} from "@/lib/tracking/accessRules";
import type { DrawnShape } from "@/components/geofence/LeafletDrawControl";

export type ZoneDraftPayload = {
  name: string;
  zone_category: string;
  access_rules: AccessRules;
  shape: DrawnShape;
};

type CompanyOpt = { id: string; name: string };

type Props = {
  open: boolean;
  shape: DrawnShape | null;
  companies: CompanyOpt[];
  saving?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: ZoneDraftPayload) => void | Promise<void>;
};

export default function ZoneAccessRulesDialog({
  open,
  shape,
  companies,
  saving,
  onOpenChange,
  onSave,
}: Props) {
  const [name, setName] = useState("위험구역");
  const [category, setCategory] = useState<string>("추락위험");
  const [mode, setMode] = useState<AccessRuleMode>("deny_all");
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [jobTypes, setJobTypes] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setName("위험구역");
    setCategory("추락위험");
    setMode("deny_all");
    setCompanyIds([]);
    setJobTypes([]);
  }, [open, shape]);

  const toggleCompany = (id: string, on: boolean) => {
    setCompanyIds((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
  };
  const toggleJob = (job: string, on: boolean) => {
    setJobTypes((prev) => (on ? [...new Set([...prev, job])] : prev.filter((x) => x !== job)));
  };

  const handleSave = async () => {
    if (!shape) return;
    const access_rules: AccessRules =
      mode === "allow_companies"
        ? { mode, company_ids: companyIds, job_types: [] }
        : mode === "allow_job_types"
          ? { mode, company_ids: [], job_types: jobTypes }
          : { ...DEFAULT_ACCESS_RULES };

    if (mode === "allow_companies" && companyIds.length === 0) return;
    if (mode === "allow_job_types" && jobTypes.length === 0) return;

    await onSave({
      name: name.trim() || "위험구역",
      zone_category: category,
      access_rules,
      shape,
    });
  };

  const shapeHint =
    shape?.kind === "circle"
      ? `원형 · 반경 ${shape.radius_m}m`
      : shape?.kind === "polygon"
        ? `다각형 · ${shape.latlngs.length}점`
        : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>위험구역 속성 · 출입 통제</DialogTitle>
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
            <Select value={category} onValueChange={setCategory}>
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

          <div className="space-y-2">
            <Label>출입 통제 / 허용 대상</Label>
            <div className="space-y-2 rounded-md border p-2.5">
              <label className="flex items-start gap-2 cursor-pointer">
                <Checkbox
                  checked={mode === "deny_all"}
                  onCheckedChange={(c) => c && setMode("deny_all")}
                />
                <span>
                  <span className="font-medium">전면 통제</span>
                  <span className="block text-[11px] text-muted-foreground">관리자 외 접근 금지 · 진입 시 전원 알람</span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <Checkbox
                  checked={mode === "allow_companies"}
                  onCheckedChange={(c) => c && setMode("allow_companies")}
                />
                <span>
                  <span className="font-medium">특정 업체만 허용</span>
                  <span className="block text-[11px] text-muted-foreground">선택한 협력사만 출입 가능</span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <Checkbox
                  checked={mode === "allow_job_types"}
                  onCheckedChange={(c) => c && setMode("allow_job_types")}
                />
                <span>
                  <span className="font-medium">특정 직종만 허용</span>
                  <span className="block text-[11px] text-muted-foreground">선택한 직종만 출입 가능</span>
                </span>
              </label>
            </div>
          </div>

          {mode === "allow_companies" && (
            <div className="space-y-2 max-h-40 overflow-auto rounded-md border p-2">
              <p className="text-[11px] text-muted-foreground">허용 업체 선택</p>
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
              {mode === "allow_companies" && companyIds.length === 0 && (
                <p className="text-[10px] text-amber-600">업체를 1곳 이상 선택하세요.</p>
              )}
            </div>
          )}

          {mode === "allow_job_types" && (
            <div className="space-y-2 max-h-40 overflow-auto rounded-md border p-2">
              <p className="text-[11px] text-muted-foreground">허용 직종 선택</p>
              {JOB_TYPE_OPTIONS.map((job) => (
                <label key={job} className="flex items-center gap-2 text-xs cursor-pointer py-0.5">
                  <Checkbox
                    checked={jobTypes.includes(job)}
                    onCheckedChange={(v) => toggleJob(job, !!v)}
                  />
                  <span>{job}</span>
                </label>
              ))}
              {jobTypes.length === 0 && (
                <p className="text-[10px] text-amber-600">직종을 1개 이상 선택하세요.</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={!!saving}>
            취소
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={
              !!saving ||
              !shape ||
              (mode === "allow_companies" && companyIds.length === 0) ||
              (mode === "allow_job_types" && jobTypes.length === 0)
            }
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            구역 저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
