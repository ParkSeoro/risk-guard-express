import { useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  isStandardJobType,
  jobCategoryEntries,
  STANDARD_JOB_TYPES,
} from "@/lib/jobCategories";

type Props = {
  projectId: string;
  /** 일괄등록 시 모든 근로자에 강제 적용 (등록 관리자 소속사) */
  companyId: string;
  companyName: string;
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
};

type Row = {
  이름?: string;
  전화번호?: string;
  직종?: string;
  "생년월일(YYYY-MM-DD)"?: string;
  "입사일(YYYY-MM-DD)"?: string;
  /** legacy column — ignored; company forced from admin */
  소속사명?: string;
};

type Parsed = {
  name: string;
  phone: string;
  job_type: string;
  birth_date: string | null;
  hire_date: string | null;
  _row: number;
  _error?: string;
};

const TEMPLATE_HEADERS = [
  "이름",
  "전화번호",
  "직종",
  "생년월일(YYYY-MM-DD)",
  "입사일(YYYY-MM-DD)",
];

const TEMPLATE_SAMPLE = [
  ["홍길동", "010-1234-5678", "철근공", "1985-03-21", "2024-09-01"],
  ["김안전", "010-2222-3333", "용접공", "1990-11-05", "2025-01-10"],
  ["이여공", "010-3333-4444", "여공", "1992-07-15", "2025-03-01"],
];

/** Common shorthand → standard name */
const JOB_ALIASES: Record<string, string> = {
  비계: "비계공",
  철근: "철근공",
  철골: "철골공",
  용접: "용접공",
  배관: "배관공",
  전기: "전기공",
  계장: "계장공",
  조공: "일반조공",
  일반: "일반조공",
};

function normalizeJobType(raw: string): string {
  const t = String(raw || "").trim();
  if (!t) return "";
  if (isStandardJobType(t)) return t;
  const aliased = JOB_ALIASES[t];
  if (aliased && isStandardJobType(aliased)) return aliased;
  return t;
}

function normalizePhone(s: string): string {
  if (!s) return "";
  const d = String(s).replace(/[^\d]/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return String(s).trim();
}

function normalizeDate(s: any): string | null {
  if (!s) return null;
  if (typeof s === "number") {
    const d = XLSX.SSF.parse_date_code(s);
    if (d) {
      const yyyy = d.y.toString().padStart(4, "0");
      const mm = d.m.toString().padStart(2, "0");
      const dd = d.d.toString().padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
  }
  const t = String(s).trim();
  const m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return null;
}

export default function WorkerBulkImportDialog({
  projectId,
  companyId,
  companyName,
  open,
  onClose,
  onDone,
}: Props) {
  const [rows, setRows] = useState<Parsed[]>([]);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);

  const downloadTemplate = () => {
    const workerSheet = XLSX.utils.aoa_to_sheet([
      TEMPLATE_HEADERS,
      ...TEMPLATE_SAMPLE,
    ]);
    workerSheet["!cols"] = [
      { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 18 },
    ];

    const jobRows: (string | number)[][] = [
      ["카테고리", "직종명"],
      ...jobCategoryEntries().flatMap(([cat, jobs]) =>
        jobs.map((job) => [cat, job]),
      ),
    ];
    const jobSheet = XLSX.utils.aoa_to_sheet(jobRows);
    jobSheet["!cols"] = [{ wch: 18 }, { wch: 16 }];

    const guide = XLSX.utils.aoa_to_sheet([
      ["근로자 일괄 등록 양식 — 안내"],
      [],
      ["1. '근로자' 시트에 한 줄에 한 명씩 입력하세요."],
      ["2. 필수: 이름, 전화번호, 직종. 선택: 생년월일, 입사일."],
      ["3. 직종은 '직종목록' 시트의 직종명 중 하나만 입력하세요 (복사·붙여넣기 권장)."],
      ["4. 소속사는 엑셀에 넣지 않습니다. 등록하는 관리자 소속 회사로 자동 지정됩니다."],
      ["5. 같은 현장 + 같은 전화번호가 이미 있으면 새 데이터로 업데이트됩니다."],
      ["6. 전화번호는 숫자만 입력해도 자동 변환됩니다 (예: 01012345678 → 010-1234-5678)."],
      ["7. 날짜 형식: YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD 모두 허용."],
      [],
      ["표준 직종 목록 (참고):"],
      [STANDARD_JOB_TYPES.join(", ")],
      [],
      ["저장 후 시스템에서 '엑셀 일괄등록' → 파일 선택 → 미리보기 확인 → 등록 실행."],
    ]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, workerSheet, "근로자");
    XLSX.utils.book_append_sheet(wb, jobSheet, "직종목록");
    XLSX.utils.book_append_sheet(wb, guide, "사용안내");
    XLSX.writeFile(wb, `근로자_일괄등록_양식.xlsx`);
  };

  const onFile = async (file: File) => {
    setFileName(file.name);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheetName = wb.SheetNames.find((n) => n === "근로자") || wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const data: Row[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
    const parsed: Parsed[] = data.map((r, i) => {
      const name = String(r["이름"] || "").trim();
      const phoneRaw = String(r["전화번호"] || "").trim();
      const phone = normalizePhone(phoneRaw);
      const job_type = normalizeJobType(String(r["직종"] || ""));
      const birth_date = normalizeDate(r["생년월일(YYYY-MM-DD)"]);
      const hire_date = normalizeDate(r["입사일(YYYY-MM-DD)"]);
      let _error: string | undefined;
      if (!name) _error = "이름 필수";
      else if (!phone || phone.replace(/\D/g, "").length < 9) _error = "전화번호 형식 오류";
      else if (!job_type) _error = "직종 필수 — '직종목록' 시트에서 선택";
      else if (!isStandardJobType(job_type)) {
        _error = "직종은 표준 목록만 허용 ('직종목록' 시트 참고)";
      }
      return { name, phone, job_type, birth_date, hire_date, _row: i + 2, _error };
    });
    setRows(parsed);
  };

  const doImport = async () => {
    if (!projectId) {
      toast.error("프로젝트를 먼저 선택하세요");
      return;
    }
    if (!companyId) {
      toast.error("소속 회사가 없습니다. 프로젝트 멤버 소속사를 확인하세요.");
      return;
    }
    const valid = rows.filter((r) => !r._error);
    if (valid.length === 0) {
      toast.error("유효한 행이 없습니다");
      return;
    }
    setImporting(true);
    try {
      const phones = valid.map((r) => r.phone);
      const { data: existing, error: exErr } = await supabase
        .from("workers")
        .select("id, phone")
        .eq("project_id", projectId)
        .in("phone", phones);
      if (exErr) throw exErr;
      const byPhone = new Map<string, string>(
        ((existing as any[]) || []).map((w) => [w.phone as string, w.id as string]),
      );

      const toInsert: any[] = [];
      const toUpdate: Array<{ id: string; patch: Record<string, unknown> }> = [];

      for (const r of valid) {
        const patch = {
          company_id: companyId,
          company_name: companyName || "",
          name: r.name,
          phone: r.phone,
          job_type: r.job_type,
          birth_date: r.birth_date,
          hire_date: r.hire_date,
          is_active: true,
        };
        const id = byPhone.get(r.phone);
        if (id) {
          toUpdate.push({ id, patch });
        } else {
          toInsert.push({
            ...patch,
            project_id: projectId,
            qr_token: crypto.randomUUID(),
          });
        }
      }

      let inserted = 0;
      let updated = 0;
      const CHUNK = 200;
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        const slice = toInsert.slice(i, i + CHUNK);
        const { error } = await supabase.from("workers").insert(slice);
        if (error) throw error;
        inserted += slice.length;
      }
      for (const u of toUpdate) {
        const { error } = await supabase.from("workers").update(u.patch).eq("id", u.id);
        if (error) throw error;
        updated += 1;
      }

      toast.success(
        `신규 ${inserted}명 · 업데이트 ${updated}명 · 오류 ${rows.length - valid.length}건`,
      );
      onDone?.();
      onClose();
      setRows([]);
      setFileName("");
    } catch (e: any) {
      toast.error("등록 실패: " + (e?.message || String(e)));
    } finally {
      setImporting(false);
    }
  };

  const validCount = rows.filter((r) => !r._error).length;
  const errorCount = rows.length - validCount;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !importing && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> 근로자 엑셀 일괄 등록
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-2" /> 양식 다운로드
            </Button>
            <label>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                }}
              />
              <Button variant="default" asChild>
                <span>
                  <Upload className="h-4 w-4 mr-2" /> 파일 선택
                </span>
              </Button>
            </label>
            {fileName && <Badge variant="secondary">{fileName}</Badge>}
          </div>

          <div className="text-xs text-muted-foreground bg-muted/40 p-3 rounded space-y-1">
            <div>
              <strong>소속사:</strong>{" "}
              {companyName ? (
                <span className="text-foreground font-medium">{companyName}</span>
              ) : (
                <span className="text-destructive">소속사 미지정 — 등록 불가</span>
              )}
              <span className="text-muted-foreground"> (등록 관리자 소속·화면에서 선택한 회사)</span>
            </div>
            <div>
              <strong>입력 컬럼:</strong> 이름 · 전화번호 · 직종 · 생년월일 · 입사일
            </div>
            <div>
              직종은 양식의 <strong>직종목록</strong> 시트에서 골라 입력하세요. 동일 전화번호는{" "}
              <strong>기존 근로자 업데이트</strong>합니다.
            </div>
          </div>

          {rows.length > 0 && (
            <>
              <div className="flex items-center gap-2 text-sm">
                <Badge className="bg-success gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {validCount}건 유효
                </Badge>
                {errorCount > 0 && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {errorCount}건 오류
                  </Badge>
                )}
                <span className="text-muted-foreground">· 총 {rows.length}행</span>
              </div>
              <div className="border rounded max-h-80 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="text-left p-2">행</th>
                      <th className="text-left p-2">이름</th>
                      <th className="text-left p-2">전화</th>
                      <th className="text-left p-2">소속사</th>
                      <th className="text-left p-2">직종</th>
                      <th className="text-left p-2">생년월일</th>
                      <th className="text-left p-2">입사일</th>
                      <th className="text-left p-2">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className={`border-b ${r._error ? "bg-destructive/5" : ""}`}>
                        <td className="p-2 text-muted-foreground">{r._row}</td>
                        <td className="p-2 font-medium">{r.name || "—"}</td>
                        <td className="p-2">{r.phone || "—"}</td>
                        <td className="p-2">{companyName || "—"}</td>
                        <td className="p-2">{r.job_type || "—"}</td>
                        <td className="p-2">{r.birth_date || "—"}</td>
                        <td className="p-2">{r.hire_date || "—"}</td>
                        <td className="p-2">
                          {r._error ? (
                            <span className="text-destructive">{r._error}</span>
                          ) : (
                            <span className="text-success">OK</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={importing}>
              취소
            </Button>
            <Button onClick={doImport} disabled={importing || validCount === 0 || !companyId}>
              {importing && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {validCount}명 등록/업데이트
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
