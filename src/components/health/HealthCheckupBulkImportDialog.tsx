import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Upload, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  downloadHealthCheckupTemplate,
  parseHealthCheckupRows,
  readHealthCheckupExcelFile,
  type ExistingCheckupLike,
  type ParsedHealthCheckupRow,
  type WorkerRosterCandidate,
} from "@/lib/healthCheckupExcel";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workers: WorkerRosterCandidate[];
  existingCheckups: ExistingCheckupLike[];
  onImported: () => Promise<void> | void;
}

export default function HealthCheckupBulkImportDialog({
  open,
  onOpenChange,
  projectId,
  workers,
  existingCheckups,
  onImported,
}: Props) {
  const [rows, setRows] = useState<ParsedHealthCheckupRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const summary = useMemo(() => {
    let valid = 0;
    let duplicate = 0;
    let error = 0;
    for (const r of rows) {
      if (r.status === "valid") valid += 1;
      else if (r.status === "duplicate") duplicate += 1;
      else error += 1;
    }
    return { valid, duplicate, error };
  }, [rows]);

  const handleFile = async (file: File) => {
    setParsing(true);
    try {
      const raw = await readHealthCheckupExcelFile(file);
      const parsed = parseHealthCheckupRows(raw, workers, existingCheckups);
      setRows(parsed);
      setFileName(file.name);
      if (parsed.length === 0) {
        toast.error("읽을 수 있는 데이터 행이 없습니다. 양식을 확인해 주세요.");
      }
    } catch (e: any) {
      toast.error(`엑셀 파일 읽기 실패: ${e?.message || "파일 형식을 확인해 주세요."}`);
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    const validRows = rows.filter((r) => r.status === "valid" && r.workerId);
    if (validRows.length === 0) {
      toast.error("등록할 수 있는 정상 행이 없습니다.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = validRows.map((r) => ({
        project_id: projectId,
        worker_id: r.workerId,
        company_id: r.companyId,
        worker_name: r.workerName,
        worker_phone: r.workerPhone,
        type: r.type,
        result: r.result,
        scheduled_date: r.scheduledDate,
        conducted_date: r.conductedDate,
        next_due_date: r.nextDueDate,
        institution: r.institution,
        restrictions: r.restrictions,
        notes: r.notes,
      }));

      // Insert in safe chunks of 100
      for (let i = 0; i < payload.length; i += 100) {
        const chunk = payload.slice(i, i + 100);
        const { error } = await supabase.from("health_checkups").insert(chunk as any);
        if (error) throw error;
      }

      toast.success(`건강진단 ${validRows.length}건을 일괄 등록했습니다.`);
      setRows([]);
      setFileName("");
      onOpenChange(false);
      await onImported();
    } catch (e: any) {
      toast.error(`일괄 등록 실패: ${e?.message || String(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setRows([]);
          setFileName("");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-4xl max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet className="h-5 w-5 text-primary" /> 건강진단 엑셀 일괄등록
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 flex-1 min-h-0 flex flex-col">
          <div className="rounded-lg border bg-muted/30 p-3 flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p className="font-medium text-foreground">
                1단계: 양식을 내려받아 작성 → 2단계: 엑셀 파일 업로드 → 3단계: 미리보기 확인 후 일괄 등록
              </p>
              <p>현장 근로자 명단({workers.length}명)과 이름·연락처로 자동 매칭되며, 오류/중복 행은 등록 전 미리 표시됩니다.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={downloadHealthCheckupTemplate}>
                <Download className="h-3.5 w-3.5" /> 양식 다운로드
              </Button>
              <label className="cursor-pointer">
                <input
                  type="file"
                  className="hidden"
                  accept=".xlsx,.xls,.csv"
                  disabled={parsing || submitting}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                    e.target.value = "";
                  }}
                />
                <Button asChild type="button" size="sm" className="gap-1.5" disabled={parsing || submitting}>
                  <span>
                    {parsing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    {fileName ? "파일 다시 선택" : "엑셀 파일 선택"}
                  </span>
                </Button>
              </label>
            </div>
          </div>

          {rows.length > 0 && (
            <>
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-muted-foreground truncate max-w-[260px]">파일: {fileName}</span>
                <Badge variant="default" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" /> 등록 가능 {summary.valid}건
                </Badge>
                {summary.duplicate > 0 && (
                  <Badge variant="secondary">중복 건너뜀 {summary.duplicate}건</Badge>
                )}
                {summary.error > 0 && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="h-3 w-3" /> 오류 {summary.error}건
                  </Badge>
                )}
              </div>

              <div className="flex-1 min-h-0 overflow-auto rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12 text-xs">행</TableHead>
                      <TableHead className="text-xs">상태</TableHead>
                      <TableHead className="text-xs">근로자</TableHead>
                      <TableHead className="text-xs">종류</TableHead>
                      <TableHead className="text-xs">판정</TableHead>
                      <TableHead className="text-xs">실시일</TableHead>
                      <TableHead className="text-xs">차기예정일</TableHead>
                      <TableHead className="text-xs">검진기관</TableHead>
                      <TableHead className="text-xs">사유 / 비고</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.rowNumber} className={r.status === "error" ? "bg-destructive/5" : undefined}>
                        <TableCell className="text-xs text-muted-foreground">{r.rowNumber}</TableCell>
                        <TableCell className="text-xs">
                          {r.status === "valid" && <Badge variant="outline" className="text-[10px] border-emerald-500 text-emerald-700">정상</Badge>}
                          {r.status === "duplicate" && <Badge variant="secondary" className="text-[10px]">중복</Badge>}
                          {r.status === "error" && <Badge variant="destructive" className="text-[10px]">오류</Badge>}
                        </TableCell>
                        <TableCell className="text-xs font-medium">{r.workerName || "-"}</TableCell>
                        <TableCell className="text-xs">{r.type}</TableCell>
                        <TableCell className="text-xs">{r.result}</TableCell>
                        <TableCell className="text-xs">{r.conductedDate || "-"}</TableCell>
                        <TableCell className="text-xs">{r.nextDueDate || "-"}</TableCell>
                        <TableCell className="text-xs">{r.institution || "-"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.error ? <span className="text-destructive">{r.error}</span> : (r.notes || "-")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            닫기
          </Button>
          <Button
            type="button"
            disabled={submitting || summary.valid === 0}
            onClick={() => void handleImport()}
            className="gap-1.5"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            정상 {summary.valid}건 일괄 등록
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
