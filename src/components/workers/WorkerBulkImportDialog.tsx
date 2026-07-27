import { useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Props = {
  projectId: string;
  defaultCompanyId?: string;
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
};

type Row = {
  이름?: string;
  전화번호?: string;
  소속사명?: string;
  직종?: string;
  "생년월일(YYYY-MM-DD)"?: string;
  "입사일(YYYY-MM-DD)"?: string;
};

type Parsed = {
  name: string;
  phone: string;
  company_name: string;
  job_type: string;
  birth_date: string | null;
  hire_date: string | null;
  _row: number;
  _error?: string;
};

const TEMPLATE_HEADERS = [
  "이름",
  "전화번호",
  "소속사명",
  "직종",
  "생년월일(YYYY-MM-DD)",
  "입사일(YYYY-MM-DD)",
];

const TEMPLATE_SAMPLE = [
  ["홍길동", "010-1234-5678", "디아이지에어가스", "철근공", "1985-03-21", "2024-09-01"],
  ["김안전", "010-2222-3333", "삼성협력사", "용접공", "1990-11-05", "2025-01-10"],
];

function normalizePhone(s: string): string {
  if (!s) return "";
  const d = String(s).replace(/[^\d]/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return String(s).trim();
}

function normalizeDate(s: any): string | null {
  if (!s) return null;
  // Excel serial date
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
  // accept YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
  const m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return null;
}

export default function WorkerBulkImportDialog({ projectId, defaultCompanyId, open, onClose, onDone }: Props) {
  const [rows, setRows] = useState<Parsed[]>([]);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      TEMPLATE_HEADERS,
      ...TEMPLATE_SAMPLE,
    ]);
    ws["!cols"] = [
      { wch: 12 }, { wch: 16 }, { wch: 20 }, { wch: 14 }, { wch: 18 }, { wch: 18 },
    ];
    const guide = XLSX.utils.aoa_to_sheet([
      ["근로자 일괄 등록 양식 — 안내"],
      [],
      ["1. '근로자' 시트에 한 줄에 한 명씩 입력하세요."],
      ["2. 필수: 이름, 전화번호, 소속사명. 선택: 직종, 생년월일, 입사일."],
      ["3. 전화번호는 숫자만 입력해도 자동 변환됩니다 (예: 01012345678 → 010-1234-5678)."],
      ["4. 날짜 형식: YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD 모두 허용."],
      ["5. 소속사명은 현장에 등록된 회사명과 일치해야 자동 연결됩니다 (일치하지 않으면 이름만 저장)."],
      ["6. 같은 현장 + 같은 전화번호는 중복으로 인식되어 건너뜁니다."],
      [],
      ["저장 후 시스템에서 '엑셀 일괄등록' → 파일 선택 → 미리보기 확인 → 등록 실행."],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "근로자");
    XLSX.utils.book_append_sheet(wb, guide, "사용안내");
    XLSX.writeFile(wb, `근로자_일괄등록_양식.xlsx`);
  };

  const onFile = async (file: File) => {
    setFileName(file.name);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheetName = wb.SheetNames.find(n => n === "근로자") || wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const data: Row[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
    const parsed: Parsed[] = data.map((r, i) => {
      const name = String(r["이름"] || "").trim();
      const phoneRaw = String(r["전화번호"] || "").trim();
      const phone = normalizePhone(phoneRaw);
      const company_name = String(r["소속사명"] || "").trim();
      const job_type = String(r["직종"] || "").trim();
      const birth_date = normalizeDate(r["생년월일(YYYY-MM-DD)"]);
      const hire_date = normalizeDate(r["입사일(YYYY-MM-DD)"]);
      let _error: string | undefined;
      if (!name) _error = "이름 필수";
      else if (!phone || phone.replace(/\D/g, "").length < 9) _error = "전화번호 형식 오류";
      else if (!company_name) _error = "소속사명 필수";
      return { name, phone, company_name, job_type, birth_date, hire_date, _row: i + 2, _error };
    });
    setRows(parsed);
  };

  const doImport = async () => {
    if (!projectId) { toast.error("프로젝트를 먼저 선택하세요"); return; }
    const valid = rows.filter(r => !r._error);
    if (valid.length === 0) { toast.error("유효한 행이 없습니다"); return; }
    setImporting(true);
    try {
      // 1) 소속사명 → company_id 매핑
      const companies = await (await import("@/lib/projectCompanies")).fetchProjectCompanies(projectId);
      const nameToId = new Map<string, string>(companies.map((c) => [c.name.trim(), c.id]));

      // 2) 중복 검사 (같은 프로젝트 + 같은 전화번호)
      const phones = valid.map(r => r.phone);
      const { data: existing } = await supabase
        .from("workers").select("phone").eq("project_id", projectId).in("phone", phones);
      const existingSet = new Set((existing || []).map((w: any) => w.phone));

      const toInsert = valid
        .filter(r => !existingSet.has(r.phone))
        .map(r => ({
          project_id: projectId,
          company_id: defaultCompanyId || nameToId.get(r.company_name) || null,
          company_name: r.company_name,
          name: r.name,
          phone: r.phone,
          job_type: r.job_type || null,
          birth_date: r.birth_date,
          hire_date: r.hire_date,
          qr_token: crypto.randomUUID(),
          is_active: true,
        }));

      if (toInsert.length === 0) {
        toast.message("새로 등록할 근로자가 없습니다 (모두 중복).");
        setImporting(false);
        return;
      }

      // 3) 청크 단위 insert (Supabase 페이로드 안정성)
      const CHUNK = 200;
      let inserted = 0;
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        const slice = toInsert.slice(i, i + CHUNK);
        const { error } = await supabase.from("workers").insert(slice);
        if (error) throw error;
        inserted += slice.length;
      }

      toast.success(`${inserted}명 등록 완료 · 중복 ${existingSet.size}건 건너뜀 · 오류 ${rows.length - valid.length}건`);
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

  const validCount = rows.filter(r => !r._error).length;
  const errorCount = rows.length - validCount;

  return (
    <Dialog open={open} onOpenChange={v => !v && !importing && onClose()}>
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
                onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }}
              />
              <Button variant="default" asChild>
                <span><Upload className="h-4 w-4 mr-2" /> 파일 선택</span>
              </Button>
            </label>
            {fileName && <Badge variant="secondary">{fileName}</Badge>}
          </div>

          <div className="text-xs text-muted-foreground bg-muted/40 p-3 rounded">
            <strong>입력 컬럼:</strong> 이름 · 전화번호 · 소속사명 · 직종 · 생년월일 · 입사일<br />
            전화번호와 날짜는 자동 정규화됩니다. 같은 현장 + 같은 전화번호는 중복으로 인식되어 건너뜁니다.
          </div>

          {rows.length > 0 && (
            <>
              <div className="flex items-center gap-2 text-sm">
                <Badge className="bg-success gap-1"><CheckCircle2 className="h-3 w-3" />{validCount}건 유효</Badge>
                {errorCount > 0 && <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" />{errorCount}건 오류</Badge>}
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
                        <td className="p-2">{r.company_name || "—"}</td>
                        <td className="p-2">{r.job_type || "—"}</td>
                        <td className="p-2">{r.birth_date || "—"}</td>
                        <td className="p-2">{r.hire_date || "—"}</td>
                        <td className="p-2">
                          {r._error
                            ? <span className="text-destructive">{r._error}</span>
                            : <span className="text-success">OK</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={importing}>취소</Button>
            <Button onClick={doImport} disabled={importing || validCount === 0}>
              {importing && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {validCount}명 등록
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
