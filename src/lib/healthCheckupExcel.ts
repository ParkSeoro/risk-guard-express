/**
 * Health checkup Excel bulk-import parser, validator, worker matcher, and template generator.
 * Matches existing project workers strictly (name + phone first, then unique name)
 * so duplicate names or unregistered workers never silently corrupt records.
 */
import * as XLSX from "xlsx";

export const HEALTH_CHECKUP_TYPES = ["일반", "특수", "배치전", "수시", "임시"] as const;
export const HEALTH_CHECKUP_RESULTS = [
  "정상A",
  "정상B",
  "요관찰C",
  "유소견D1",
  "유소견D2",
  "판정불가",
  "미수검",
] as const;

export type HealthCheckupType = (typeof HEALTH_CHECKUP_TYPES)[number];
export type HealthCheckupResult = (typeof HEALTH_CHECKUP_RESULTS)[number];

export interface WorkerRosterCandidate {
  id: string;
  name: string;
  phone?: string | null;
  company_id?: string | null;
  company_name?: string | null;
}

export interface ExistingCheckupLike {
  worker_id?: string | null;
  type?: string | null;
  conducted_date?: string | null;
  scheduled_date?: string | null;
}

export interface ParsedHealthCheckupRow {
  rowNumber: number;
  rawName: string;
  rawPhone: string;
  workerId: string | null;
  companyId: string | null;
  workerName: string;
  workerPhone: string | null;
  type: HealthCheckupType;
  result: HealthCheckupResult;
  scheduledDate: string | null;
  conductedDate: string | null;
  nextDueDate: string | null;
  institution: string | null;
  restrictions: string | null;
  notes: string | null;
  status: "valid" | "duplicate" | "error";
  error?: string;
}

function normalizeDigits(val: unknown): string {
  return String(val ?? "").replace(/\D/g, "");
}

function normalizeText(val: unknown): string {
  return String(val ?? "").trim();
}

/**
 * Normalizes Excel serial date numbers, YYYY-MM-DD, YYYY.MM.DD, YYYY/MM/DD, YYYYMMDD -> YYYY-MM-DD.
 */
export function normalizeExcelDate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 20000 && raw < 80000) {
    // Excel epoch (1899-12-30)
    const utcMs = Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000;
    const d = new Date(utcMs);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const kst = new Date(raw.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  if (!s) return null;
  const sep = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (sep) {
    const y = Number(sep[1]);
    const m = Number(sep[2]);
    const d = Number(sep[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    const m = Number(compact[2]);
    const d = Number(compact[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${compact[1]}-${compact[2]}-${compact[3]}`;
    }
  }
  return null;
}

const HEADER_ALIASES: Record<string, string> = {
  근로자명: "name",
  이름: "name",
  성명: "name",
  근로자: "name",
  연락처: "phone",
  전화번호: "phone",
  휴대폰: "phone",
  종류: "type",
  진단종류: "type",
  검진종류: "type",
  구분: "type",
  판정: "result",
  판정결과: "result",
  결과: "result",
  예정일: "scheduled_date",
  검진예정일: "scheduled_date",
  실시일: "conducted_date",
  검진일: "conducted_date",
  검진실시일: "conducted_date",
  차기예정일: "next_due_date",
  차기검진일: "next_due_date",
  검진기관: "institution",
  병원: "institution",
  기관: "institution",
  사후조치: "restrictions",
  제한사항: "restrictions",
  작업제한: "restrictions",
  "사후조치/제한사항": "restrictions",
  비고: "notes",
  메모: "notes",
};

function mapRowColumns(rawRow: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawRow)) {
    const cleanKey = k.replace(/\s+/g, "").replace(/\*$/, "");
    const mapped = HEADER_ALIASES[cleanKey];
    if (mapped && out[mapped] === undefined) {
      out[mapped] = v;
    }
  }
  return out;
}

function normalizeCheckupType(raw: unknown): HealthCheckupType | null {
  const s = normalizeText(raw).replace(/건강진단|검진/g, "");
  if (!s) return "일반";
  if ((HEALTH_CHECKUP_TYPES as readonly string[]).includes(s)) {
    return s as HealthCheckupType;
  }
  return null;
}

function normalizeCheckupResult(raw: unknown): HealthCheckupResult | null {
  const s = normalizeText(raw).replace(/\s+/g, "");
  if (!s) return "미수검";
  if ((HEALTH_CHECKUP_RESULTS as readonly string[]).includes(s)) {
    return s as HealthCheckupResult;
  }
  if (s === "A" || s === "정상") return "정상A";
  if (s === "B") return "정상B";
  if (s === "C" || s === "요관찰") return "요관찰C";
  if (s === "D1") return "유소견D1";
  if (s === "D2") return "유소견D2";
  return null;
}

export function matchWorkerForCheckup(
  name: string,
  phone: string,
  workers: WorkerRosterCandidate[],
): { worker?: WorkerRosterCandidate; error?: string } {
  const cleanName = name.trim();
  const cleanPhone = normalizeDigits(phone);
  if (!cleanName) return { error: "근로자명이 비어 있습니다." };

  const nameMatches = workers.filter((w) => w.name.trim() === cleanName);
  if (cleanPhone) {
    const exactBoth = nameMatches.filter((w) => normalizeDigits(w.phone) === cleanPhone);
    if (exactBoth.length === 1) return { worker: exactBoth[0] };
    const phoneOnly = workers.filter((w) => normalizeDigits(w.phone) === cleanPhone);
    if (phoneOnly.length === 1 && phoneOnly[0].name.trim() === cleanName) {
      return { worker: phoneOnly[0] };
    }
    if (exactBoth.length > 1) {
      return { error: "동일 이름·연락처 근로자가 중복 등록되어 있습니다." };
    }
  }

  if (nameMatches.length === 1) {
    return { worker: nameMatches[0] };
  }
  if (nameMatches.length > 1) {
    return { error: `동명이인(${nameMatches.length}명)입니다. 연락처를 함께 입력하세요.` };
  }
  return { error: "현장 근로자 명단에서 찾을 수 없습니다." };
}

function dupKey(workerId: string, type: string, conductedDate: string | null, scheduledDate: string | null): string {
  return `${workerId}|${type}|${conductedDate || ""}|${scheduledDate || ""}`;
}

export function parseHealthCheckupRows(
  rawRows: Record<string, unknown>[],
  workers: WorkerRosterCandidate[],
  existingCheckups: ExistingCheckupLike[] = [],
): ParsedHealthCheckupRow[] {
  const existingKeys = new Set<string>();
  for (const ex of existingCheckups) {
    if (!ex.worker_id || !ex.type) continue;
    existingKeys.add(dupKey(ex.worker_id, ex.type, ex.conducted_date ?? null, ex.scheduled_date ?? null));
  }
  const seenInBatch = new Set<string>();
  const out: ParsedHealthCheckupRow[] = [];

  for (let i = 0; i < rawRows.length; i += 1) {
    const mapped = mapRowColumns(rawRows[i] || {});
    const rawName = normalizeText(mapped.name);
    const rawPhone = normalizeText(mapped.phone);
    // Skip completely blank trailing rows
    if (!rawName && !rawPhone && !normalizeText(mapped.institution) && !normalizeText(mapped.conducted_date)) {
      continue;
    }

    const rowNumber = i + 2; // 1-based + header row
    const match = matchWorkerForCheckup(rawName, rawPhone, workers);
    const parsedType = normalizeCheckupType(mapped.type);
    const parsedResult = normalizeCheckupResult(mapped.result);
    const scheduledDate = normalizeExcelDate(mapped.scheduled_date);
    const conductedDate = normalizeExcelDate(mapped.conducted_date);
    const nextDueDate = normalizeExcelDate(mapped.next_due_date);

    const errors: string[] = [];
    if (match.error) errors.push(match.error);
    if (!parsedType) errors.push(`종류 오류('${normalizeText(mapped.type)}' — 일반/특수/배치전/수시/임시만 가능)`);
    if (!parsedResult) errors.push(`판정 오류('${normalizeText(mapped.result)}' — 정상A/정상B/요관찰C/유소견D1/유소견D2/판정불가/미수검)`);
    if (normalizeText(mapped.scheduled_date) && !scheduledDate) errors.push("예정일 날짜 형식 오류(YYYY-MM-DD)");
    if (normalizeText(mapped.conducted_date) && !conductedDate) errors.push("실시일 날짜 형식 오류(YYYY-MM-DD)");
    if (normalizeText(mapped.next_due_date) && !nextDueDate) errors.push("차기예정일 날짜 형식 오류(YYYY-MM-DD)");

    const type: HealthCheckupType = parsedType ?? "일반";
    const result: HealthCheckupResult = parsedResult ?? "미수검";

    if (errors.length > 0 || !match.worker) {
      out.push({
        rowNumber,
        rawName,
        rawPhone,
        workerId: null,
        companyId: null,
        workerName: rawName,
        workerPhone: rawPhone || null,
        type,
        result,
        scheduledDate,
        conductedDate,
        nextDueDate,
        institution: normalizeText(mapped.institution) || null,
        restrictions: normalizeText(mapped.restrictions) || null,
        notes: normalizeText(mapped.notes) || null,
        status: "error",
        error: errors.join(" / "),
      });
      continue;
    }

    const key = dupKey(match.worker.id, type, conductedDate, scheduledDate);
    const isDup = existingKeys.has(key) || seenInBatch.has(key);
    seenInBatch.add(key);

    out.push({
      rowNumber,
      rawName,
      rawPhone,
      workerId: match.worker.id,
      companyId: match.worker.company_id ?? null,
      workerName: match.worker.name,
      workerPhone: match.worker.phone ?? (rawPhone || null),
      type,
      result,
      scheduledDate,
      conductedDate,
      nextDueDate,
      institution: normalizeText(mapped.institution) || null,
      restrictions: normalizeText(mapped.restrictions) || null,
      notes: normalizeText(mapped.notes) || null,
      status: isDup ? "duplicate" : "valid",
      error: isDup ? "이미 등록된 동일 진단 기록(건너뜀)" : undefined,
    });
  }

  return out;
}

export async function readHealthCheckupExcelFile(file: File): Promise<Record<string, unknown>[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return [];
  const ws = wb.Sheets[firstSheet];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
}

export function downloadHealthCheckupTemplate(): void {
  const sampleRows = [
    {
      "근로자명*": "홍길동",
      연락처: "010-1234-5678",
      "종류*": "일반",
      판정결과: "정상A",
      예정일: "2026-11-20",
      실시일: "2026-11-20",
      차기예정일: "2027-11-20",
      검진기관: "서울산업보건센터",
      "사후조치/제한사항": "",
      비고: "정기검진 완료",
    },
  ];
  const guideRows = [
    { 항목: "근로자명*", 설명: "현장 근로자 명단에 등록된 이름 (필수)" },
    { 항목: "연락처", 설명: "동명이인 구분용 (권장, 예: 010-1234-5678)" },
    { 항목: "종류*", 설명: HEALTH_CHECKUP_TYPES.join(" / ") },
    { 항목: "판정결과", 설명: `${HEALTH_CHECKUP_RESULTS.join(" / ")} (비우면 미수검)` },
    { 항목: "예정일·실시일·차기예정일", 설명: "YYYY-MM-DD 형식 (예: 2026-11-20)" },
  ];

  const wb = XLSX.utils.book_new();
  const wsData = XLSX.utils.json_to_sheet(sampleRows);
  wsData["!cols"] = [
    { wch: 12 }, { wch: 15 }, { wch: 10 }, { wch: 12 }, { wch: 13 },
    { wch: 13 }, { wch: 13 }, { wch: 20 }, { wch: 22 }, { wch: 20 },
  ];
  const wsGuide = XLSX.utils.json_to_sheet(guideRows);
  wsGuide["!cols"] = [{ wch: 24 }, { wch: 52 }];

  XLSX.utils.book_append_sheet(wb, wsData, "건강진단_일괄등록");
  XLSX.utils.book_append_sheet(wb, wsGuide, "입력안내");
  XLSX.writeFile(wb, "건강진단_일괄등록_양식.xlsx");
}
