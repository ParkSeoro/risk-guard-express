import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sparkles, Upload, Loader2, Trash2, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { uploadAttachmentFile } from "@/lib/compressUploadFile";
import {
  HEALTH_CHECKUP_RESULTS,
  HEALTH_CHECKUP_TYPES,
  matchWorkerForCheckup,
  type HealthCheckupResult,
  type HealthCheckupType,
  type WorkerRosterCandidate,
} from "@/lib/healthCheckupExcel";
import { analyzeHealthCheckupFile } from "@/lib/healthCheckupOcr";

interface BatchItem {
  id: string;
  file: File;
  status: "pending" | "scanning" | "ready" | "error";
  error?: string;
  workerId: string;
  ocrWorkerName: string;
  type: HealthCheckupType;
  result: HealthCheckupResult;
  conductedDate: string;
  nextDueDate: string;
  institution: string;
  restrictions: string;
  hazardFactors: string[];
  enableDailyLog: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workers: WorkerRosterCandidate[];
  onSaved: () => Promise<void> | void;
}

export default function HealthCheckupBatchOcrDialog({
  open,
  onOpenChange,
  projectId,
  workers,
  onSaved,
}: Props) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;

    const created: BatchItem[] = arr.map((f, idx) => ({
      id: `${Date.now()}-${idx}`,
      file: f,
      status: "pending",
      workerId: "",
      ocrWorkerName: "",
      type: "배치전",
      result: "미수검",
      conductedDate: "",
      nextDueDate: "",
      institution: "",
      restrictions: "",
      hazardFactors: [],
      enableDailyLog: false,
    }));
    setItems((prev) => [...prev, ...created]);

    setScanning(true);
    try {
      for (const item of created) {
        setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, status: "scanning" } : x)));
        const ocr = await analyzeHealthCheckupFile(item.file);
        if (!ocr.ok) {
          setItems((prev) =>
            prev.map((x) => (x.id === item.id ? { ...x, status: "error", error: ocr.error } : x)),
          );
          continue;
        }
        const matched = ocr.workerName ? matchWorkerForCheckup(ocr.workerName, "", workers) : {};
        setItems((prev) =>
          prev.map((x) =>
            x.id === item.id
              ? {
                  ...x,
                  status: "ready",
                  workerId: matched.worker?.id || "",
                  ocrWorkerName: ocr.workerName || "",
                  type: ocr.type || "일반",
                  result: ocr.result || "미수검",
                  conductedDate: ocr.conductedDate || "",
                  nextDueDate: ocr.suggestedNextDueDate || "",
                  institution: ocr.institution || "",
                  restrictions: ocr.restrictions || "",
                  hazardFactors: ocr.hazardFactors,
                  enableDailyLog: ocr.recommendDailyHealthLog,
                  error: matched.worker ? undefined : matched.error || "근로자를 선택해 주세요.",
                }
              : x,
          ),
        );
      }
      toast.success(`결과지 ${created.length}건 AI 판독을 마쳤습니다. 확인 후 일괄 저장하세요.`);
    } finally {
      setScanning(false);
    }
  };

  const updateItem = (id: string, patch: Partial<BatchItem>) => {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
  };

  const readyToSave = items.filter((x) => x.workerId && x.status !== "scanning");

  const handleSaveAll = async () => {
    if (readyToSave.length === 0) {
      toast.error("근로자가 지정된 항목이 없습니다.");
      return;
    }
    setSaving(true);
    try {
      let savedCount = 0;
      const dailyLogWorkerIds = new Set<string>();

      for (const item of readyToSave) {
        const worker = workers.find((w) => w.id === item.workerId);
        const safeName = item.file.name.replace(/[^\w.\-]+/g, "_");
        const path = `${projectId}/health-checkups/${item.workerId}_${Date.now()}_${safeName}`;
        let reportUrl: string | null = null;
        try {
          const uploaded = await uploadAttachmentFile(path, item.file);
          reportUrl = uploaded.publicUrl;
        } catch (e: any) {
          toast.error(`${item.file.name} 원본 업로드 실패: ${e?.message || "오류"}`);
        }

        const { error } = await supabase.from("health_checkups").insert({
          project_id: projectId,
          worker_id: item.workerId,
          company_id: worker?.company_id ?? null,
          worker_name: worker?.name ?? item.ocrWorkerName,
          worker_phone: worker?.phone ?? null,
          type: item.type,
          result: item.result,
          conducted_date: item.conductedDate || null,
          next_due_date: item.nextDueDate || null,
          institution: item.institution || null,
          restrictions: item.restrictions || null,
          hazard_factors: item.hazardFactors.length > 0 ? item.hazardFactors : null,
          report_url: reportUrl,
        } as any);
        if (error) throw error;
        savedCount += 1;
        if (item.enableDailyLog) dailyLogWorkerIds.add(item.workerId);
      }

      if (dailyLogWorkerIds.size > 0) {
        await supabase
          .from("workers")
          .update({ requires_daily_health_log: true } as any)
          .in("id", Array.from(dailyLogWorkerIds));
      }

      toast.success(
        `건강진단 ${savedCount}건 저장 완료${dailyLogWorkerIds.size > 0 ? ` (일일건강체크 대상 ${dailyLogWorkerIds.size}명 지정)` : ""}`,
      );
      setItems([]);
      onOpenChange(false);
      await onSaved();
    } catch (e: any) {
      toast.error(`일괄 저장 실패: ${e?.message || String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !scanning && !saving) setItems([]);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-5xl max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-primary" /> 결과지 여러 장 AI 일괄 판독 (배치전·일반·특수)
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 flex-1 min-h-0 flex flex-col">
          <div className="rounded-lg border bg-primary/5 border-primary/25 p-3 flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs space-y-0.5">
              <p className="font-medium text-foreground">
                결과지 사진·PDF를 여러 장 한꺼번에 올리면 AI가 성명·종류·등급·실시일·차기예정일·유해인자·제한사항을 자동 추출합니다.
              </p>
              <p className="text-[11px] text-muted-foreground">
                주민등록번호·세부 병명은 추출하지 않으며, 판독 결과는 아래 표에서 자유롭게 수정한 뒤 저장합니다.
              </p>
            </div>
            <label className="cursor-pointer shrink-0">
              <input
                type="file"
                multiple
                className="hidden"
                accept="image/*,application/pdf"
                disabled={scanning || saving}
                onChange={(e) => {
                  if (e.target.files?.length) void handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <Button asChild type="button" size="sm" className="gap-1.5" disabled={scanning || saving}>
                <span>
                  {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {scanning ? "AI 판독 중…" : "결과지 파일 추가"}
                </span>
              </Button>
            </label>
          </div>

          {items.length > 0 && (
            <div className="flex-1 min-h-0 overflow-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">파일 / 판독</TableHead>
                    <TableHead className="text-xs min-w-[140px]">근로자 *</TableHead>
                    <TableHead className="text-xs w-24">종류</TableHead>
                    <TableHead className="text-xs w-28">판정</TableHead>
                    <TableHead className="text-xs w-32">실시일</TableHead>
                    <TableHead className="text-xs w-32">차기예정일</TableHead>
                    <TableHead className="text-xs min-w-[140px]">제한·유해인자</TableHead>
                    <TableHead className="text-xs text-center w-20">일일체크</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-xs max-w-[160px]">
                        <p className="truncate font-medium" title={item.file.name}>{item.file.name}</p>
                        {item.status === "scanning" && (
                          <span className="text-[10px] text-primary inline-flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" /> 판독 중…
                          </span>
                        )}
                        {item.status === "ready" && (
                          <span className="text-[10px] text-emerald-700 inline-flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> {item.ocrWorkerName || "판독 완료"}
                          </span>
                        )}
                        {item.error && (
                          <p className="text-[10px] text-destructive flex items-center gap-0.5 mt-0.5">
                            <AlertTriangle className="h-3 w-3 shrink-0" /> {item.error}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={item.workerId}
                          onValueChange={(v) => updateItem(item.id, { workerId: v, error: undefined })}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue placeholder="근로자 선택" />
                          </SelectTrigger>
                          <SelectContent>
                            {workers.map((w) => (
                              <SelectItem key={w.id} value={w.id}>
                                {w.name} {w.company_name ? `(${w.company_name})` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select value={item.type} onValueChange={(v) => updateItem(item.id, { type: v as HealthCheckupType })}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {HEALTH_CHECKUP_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select value={item.result} onValueChange={(v) => updateItem(item.id, { result: v as HealthCheckupResult })}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {HEALTH_CHECKUP_RESULTS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="date"
                          className="h-7 text-xs"
                          value={item.conductedDate}
                          onChange={(e) => updateItem(item.id, { conductedDate: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="date"
                          className="h-7 text-xs"
                          value={item.nextDueDate}
                          onChange={(e) => updateItem(item.id, { nextDueDate: e.target.value })}
                        />
                      </TableCell>
                      <TableCell className="space-y-1">
                        <Input
                          className="h-7 text-xs"
                          placeholder="작업제한 소견"
                          value={item.restrictions}
                          onChange={(e) => updateItem(item.id, { restrictions: e.target.value })}
                        />
                        {item.hazardFactors.length > 0 && (
                          <div className="flex gap-1 flex-wrap">
                            {item.hazardFactors.slice(0, 3).map((hf) => (
                              <Badge key={hf} variant="outline" className="text-[9px] h-4 px-1">{hf}</Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox
                          checked={item.enableDailyLog}
                          onCheckedChange={(v) => updateItem(item.id, { enableDailyLog: !!v })}
                          aria-label="일일건강체크 대상 지정"
                        />
                      </TableCell>
                      <TableCell>
                        <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeItem(item.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={scanning || saving}>
            닫기
          </Button>
          <Button
            type="button"
            disabled={scanning || saving || readyToSave.length === 0}
            onClick={() => void handleSaveAll()}
            className="gap-1.5"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            확인 완료 {readyToSave.length}건 일괄 저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
