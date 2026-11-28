/**
 * Tier 1 Universal Document Parser & Diff Engine (Zero extra server cost).
 * Parses Excel (.xlsx/.xls/.csv), PDF (.pdf), Word (.docx), PowerPoint (.pptx),
 * and plain text directly in the browser, and computes deterministic Rev.0 vs Rev.1 diffs.
 */
import * as XLSX from 'xlsx';

export type SupportedDocKind = 'excel' | 'pdf' | 'word' | 'ppt' | 'text';

export interface ParsedPlantDocument {
  fileName: string;
  kind: SupportedDocKind;
  sectionCount: number;
  charCount: number;
  sections: { title: string; lines: string[] }[];
  fullText: string;
}

export type DocDiffChangeType = 'added' | 'removed' | 'modified';

export interface DocDiffEntry {
  type: DocDiffChangeType;
  lineNoA?: number;
  lineNoB?: number;
  before?: string;
  after?: string;
  hasNumericChange: boolean;
}

export interface DocDiffSummary {
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  numericChangeCount: number;
  entries: DocDiffEntry[];
}

export function detectDocKind(fileName: string): SupportedDocKind {
  const lower = fileName.toLowerCase();
  if (/\.(xlsx|xls|csv)$/.test(lower)) return 'excel';
  if (/\.pdf$/.test(lower)) return 'pdf';
  if (/\.docx$/.test(lower)) return 'word';
  if (/\.pptx$/.test(lower)) return 'ppt';
  return 'text';
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripXmlToLines(xml: string, blockTag: string): string[] {
  const blocks = xml.split(new RegExp(`</${blockTag}>`, 'i'));
  const lines: string[] = [];
  for (const blk of blocks) {
    const text = decodeXmlEntities(blk.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (text) lines.push(text);
  }
  return lines;
}

async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('이 환경에서는 압축 해제(DecompressionStream)를 지원하지 않습니다.');
  }
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  await writer.write(compressed as unknown as BufferSource);
  await writer.close();
  const ab = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(ab);
}

/**
 * Minimal pure-TypeScript ZIP Central Directory extractor for .docx / .pptx.
 * Supports method 0 (stored) and method 8 (deflate) with zero external packages.
 */
export async function extractZipTextEntries(
  buffer: ArrayBuffer,
  predicate: (entryName: string) => boolean,
): Promise<Map<string, string>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const results = new Map<string, string>();
  const decoder = new TextDecoder('utf-8');

  // Locate End of Central Directory (EOCD: 0x06054b50) scanning backwards
  let eocdOffset = -1;
  const minOffset = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minOffset; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('올바른 Office(ZIP) 문서 형식이 아닙니다.');
  }

  const cdEntries = view.getUint16(eocdOffset + 10, true);
  let cdOffset = view.getUint32(eocdOffset + 16, true);

  for (let idx = 0; idx < cdEntries; idx++) {
    if (cdOffset + 46 > bytes.length || view.getUint32(cdOffset, true) !== 0x02014b50) break;
    const method = view.getUint16(cdOffset + 10, true);
    const compressedSize = view.getUint32(cdOffset + 20, true);
    const nameLen = view.getUint16(cdOffset + 28, true);
    const extraLen = view.getUint16(cdOffset + 30, true);
    const commentLen = view.getUint16(cdOffset + 32, true);
    const localHeaderOffset = view.getUint32(cdOffset + 42, true);
    const name = decoder.decode(bytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen));

    cdOffset += 46 + nameLen + extraLen + commentLen;
    if (!predicate(name)) continue;

    if (localHeaderOffset + 30 > bytes.length || view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      continue;
    }
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const slice = bytes.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) {
      results.set(name, decoder.decode(slice));
    } else if (method === 8) {
      const inflated = await inflateRawBytes(slice);
      results.set(name, decoder.decode(inflated));
    }
  }

  return results;
}

export async function parsePlantDocumentBuffer(
  fileName: string,
  buffer: ArrayBuffer,
): Promise<ParsedPlantDocument> {
  const kind = detectDocKind(fileName);
  const sections: { title: string; lines: string[] }[] = [];

  if (kind === 'excel') {
    const wb = XLSX.read(buffer, { type: 'array' });
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
      const lines = rows
        .map((r) =>
          (Array.isArray(r) ? r : [])
            .map((c) => String(c ?? '').trim())
            .filter(Boolean)
            .join(' | '),
        )
        .filter(Boolean);
      if (lines.length > 0) sections.push({ title: `시트: ${sheetName}`, lines });
    }
  } else if (kind === 'word') {
    const entries = await extractZipTextEntries(buffer, (n) => n === 'word/document.xml');
    const xml = entries.get('word/document.xml') || '';
    const lines = stripXmlToLines(xml, 'w:p');
    sections.push({ title: '본문 (Word)', lines });
  } else if (kind === 'ppt') {
    const entries = await extractZipTextEntries(buffer, (n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n));
    const slideNames = Array.from(entries.keys()).sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/i)?.[1] || 0);
      const nb = Number(b.match(/slide(\d+)/i)?.[1] || 0);
      return na - nb;
    });
    for (const name of slideNames) {
      const num = name.match(/slide(\d+)/i)?.[1] || '';
      const lines = stripXmlToLines(entries.get(name) || '', 'a:p');
      if (lines.length > 0) sections.push({ title: `슬라이드 ${num}`, lines });
    }
  } else if (kind === 'pdf') {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
    const maxPages = Math.min(pdf.numPages, 25);
    for (let p = 1; p <= maxPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const raw = tc.items
        .map((it: any) => (typeof it?.str === 'string' ? it.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (raw) {
        const lines = raw.split(/(?<=[.!?])\s+|(?=\d+\.\s)/).map((l) => l.trim()).filter(Boolean);
        sections.push({ title: `페이지 ${p}`, lines });
      }
    }
  } else {
    const text = new TextDecoder('utf-8').decode(new Uint8Array(buffer));
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    sections.push({ title: '텍스트 본문', lines });
  }

  const fullText = sections
    .map((s) => `[${s.title}]\n${s.lines.join('\n')}`)
    .join('\n\n');

  return {
    fileName,
    kind,
    sectionCount: sections.length,
    charCount: fullText.length,
    sections,
    fullText,
  };
}

function normalizeForKey(line: string): string {
  return line
    .replace(/\d+(?:[.,]\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractNumbers(line: string): string {
  return (line.match(/\d+(?:[.,]\d+)?/g) || []).join(',');
}

/**
 * Deterministic Rev.0 vs Rev.1 document diff with numeric spec/cost change detection.
 */
export function compareDocumentTexts(textA: string, textB: string): DocDiffSummary {
  const linesA = textA.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const linesB = textB.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const setA = new Set(linesA);
  const setB = new Set(linesB);

  const removedRaw = linesA
    .map((line, i) => ({ line, lineNo: i + 1 }))
    .filter((item) => !setB.has(item.line));
  const addedRaw = linesB
    .map((line, i) => ({ line, lineNo: i + 1 }))
    .filter((item) => !setA.has(item.line));

  const entries: DocDiffEntry[] = [];
  const matchedAddedIdx = new Set<number>();

  for (const rem of removedRaw) {
    const remKey = normalizeForKey(rem.line);
    const matchIdx = addedRaw.findIndex(
      (add, idx) => !matchedAddedIdx.has(idx) && normalizeForKey(add.line) === remKey,
    );
    if (matchIdx >= 0) {
      matchedAddedIdx.add(matchIdx);
      const add = addedRaw[matchIdx];
      entries.push({
        type: 'modified',
        lineNoA: rem.lineNo,
        lineNoB: add.lineNo,
        before: rem.line,
        after: add.line,
        hasNumericChange: extractNumbers(rem.line) !== extractNumbers(add.line),
      });
    } else {
      entries.push({
        type: 'removed',
        lineNoA: rem.lineNo,
        before: rem.line,
        hasNumericChange: /\d/.test(rem.line),
      });
    }
  }

  addedRaw.forEach((add, idx) => {
    if (!matchedAddedIdx.has(idx)) {
      entries.push({
        type: 'added',
        lineNoB: add.lineNo,
        after: add.line,
        hasNumericChange: /\d/.test(add.line),
      });
    }
  });

  return {
    addedCount: entries.filter((e) => e.type === 'added').length,
    removedCount: entries.filter((e) => e.type === 'removed').length,
    modifiedCount: entries.filter((e) => e.type === 'modified').length,
    numericChangeCount: entries.filter((e) => e.hasNumericChange).length,
    entries,
  };
}

export function downloadDocDiffExcel(docAName: string, docBName: string, diff: DocDiffSummary): void {
  const rows = diff.entries.map((e, i) => ({
    번호: i + 1,
    변경유형: e.type === 'modified' ? '수정됨' : e.type === 'added' ? '신규추가' : '삭제됨',
    수치변경: e.hasNumericChange ? 'Y (주의)' : 'N',
    '기준문서(Rev.0)': e.before || '',
    '비교문서(Rev.1)': e.after || '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '문서비교_Diff');
  XLSX.writeFile(wb, `문서비교_${docAName.replace(/\.[^.]+$/, '')}_vs_${docBName.replace(/\.[^.]+$/, '')}.xlsx`);
}

export const SAMPLE_SPEC_REV0: ParsedPlantDocument = {
  fileName: '에어리퀴드_LOX배관_공사시방서_Rev0.docx',
  kind: 'word',
  sectionCount: 1,
  charCount: 412,
  sections: [
    {
      title: '본문 (Word)',
      lines: [
        '1. 공사명: 여수 산업가스 플랜트 LOX 극저온 공급배관 신설공사',
        '2. 배관 재질: ASTM A312 TP304L Sch.40S (전량 산소탈지 O2 Cleaning 필수)',
        '3. 설계압력: 16 bar / 설계온도: -183°C',
        '4. 비파괴검사(NDT): 현장 맞대기 용접부 RT 100% 실시 (시공사 부담)',
        '5. 안전밸브(PSV): 극저온 이중차단 구간 Thermal Relief PSV 2개소 설치 포함',
        '6. 공사금액: 금 245,000,000원 (부가세 별도, 탈지 및 RT 비용 포함)',
        '7. 준공기한: 착공일로부터 90일 이내',
      ],
    },
  ],
  fullText: [
    '1. 공사명: 여수 산업가스 플랜트 LOX 극저온 공급배관 신설공사',
    '2. 배관 재질: ASTM A312 TP304L Sch.40S (전량 산소탈지 O2 Cleaning 필수)',
    '3. 설계압력: 16 bar / 설계온도: -183°C',
    '4. 비파괴검사(NDT): 현장 맞대기 용접부 RT 100% 실시 (시공사 부담)',
    '5. 안전밸브(PSV): 극저온 이중차단 구간 Thermal Relief PSV 2개소 설치 포함',
    '6. 공사금액: 금 245,000,000원 (부가세 별도, 탈지 및 RT 비용 포함)',
    '7. 준공기한: 착공일로부터 90일 이내',
  ].join('\n'),
};

export const SAMPLE_SPEC_REV1: ParsedPlantDocument = {
  fileName: '시공사_제출_수정시방서_Rev1.docx',
  kind: 'word',
  sectionCount: 1,
  charCount: 438,
  sections: [
    {
      title: '본문 (Word)',
      lines: [
        '1. 공사명: 여수 산업가스 플랜트 LOX 극저온 공급배관 신설공사',
        '2. 배관 재질: ASTM A312 TP304L Sch.40S (일반 에어블로잉 세정 적용)',
        '3. 설계압력: 16 bar / 설계온도: -183°C',
        '4. 비파괴검사(NDT): 현장 맞대기 용접부 RT 10% 실시 (발주처 추가 요청 시 별도 정산)',
        '5. 안전밸브(PSV): 극저온 이중차단 구간 Thermal Relief PSV 0개소 (별도 공사 제외)',
        '6. 공사금액: 금 278,000,000원 (부가세 별도, 탈지 및 RT 비용 별도 청구)',
        '7. 준공기한: 착공일로부터 120일 이내',
      ],
    },
  ],
  fullText: [
    '1. 공사명: 여수 산업가스 플랜트 LOX 극저온 공급배관 신설공사',
    '2. 배관 재질: ASTM A312 TP304L Sch.40S (일반 에어블로잉 세정 적용)',
    '3. 설계압력: 16 bar / 설계온도: -183°C',
    '4. 비파괴검사(NDT): 현장 맞대기 용접부 RT 10% 실시 (발주처 추가 요청 시 별도 정산)',
    '5. 안전밸브(PSV): 극저온 이중차단 구간 Thermal Relief PSV 0개소 (별도 공사 제외)',
    '6. 공사금액: 금 278,000,000원 (부가세 별도, 탈지 및 RT 비용 별도 청구)',
    '7. 준공기한: 착공일로부터 120일 이내',
  ].join('\n'),
};
