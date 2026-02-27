import * as XLSX from 'xlsx';

export interface ParsedRow {
  [key: string]: string;
}

export interface ColumnMapping {
  processName: string;    // which column = 공정명
  subTask?: string;       // which column = 세부작업
  period?: string;        // which column = 기간
  contractor?: string;    // which column = 협력사
  location?: string;      // which column = 위치/구역
}

export function parseScheduleFile(file: File): Promise<{ headers: string[]; rows: ParsedRow[] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(firstSheet, { defval: '' });

        if (jsonData.length === 0) {
          resolve({ headers: [], rows: [] });
          return;
        }

        const headers = Object.keys(jsonData[0]);
        const rows: ParsedRow[] = jsonData.map(row => {
          const parsed: ParsedRow = {};
          for (const key of headers) {
            parsed[key] = String(row[key] || '').trim();
          }
          return parsed;
        });

        resolve({ headers, rows });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export function extractProcesses(rows: ParsedRow[], mapping: ColumnMapping): { processName: string; subTask?: string }[] {
  const processes: { processName: string; subTask?: string }[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const processName = row[mapping.processName]?.trim();
    if (!processName) continue;

    const subTask = mapping.subTask ? row[mapping.subTask]?.trim() : undefined;
    const key = `${processName}|${subTask || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    processes.push({ processName, subTask });
  }

  return processes;
}
