/** 발신 공문 원문에서 문서번호·수신·제목을 고른다. 번호가 없으면 만들지 않는다. */

export const OUTGOING_DOC_PATTERN =
  /ALK\s*Technology\s*[-–—]\s*Construction\s*Safety\s*[-–—]\s*(\d{2})\s*[-–—]\s*(\d{1,4})\s*호/i;

export const RECEIVED_DOC_PATTERN = /ALK-REC-(\d{2})-(\d{1,4})호/i;

export function canonicalOutgoingDocNumber(year2: string, sequence: number): string {
  const seq = String(sequence).padStart(2, '0');
  return `ALK Technology - Construction Safety - ${year2}-${seq}호`;
}

export function canonicalReceivedDocNumber(year2: string, sequence: number): string {
  const seq = String(sequence).padStart(2, '0');
  return `ALK-REC-${year2}-${seq}호`;
}

export function readOutgoingDocNumber(text: string): { year2: string; sequence: number; docNumber: string } | null {
  const match = String(text || '').match(OUTGOING_DOC_PATTERN);
  if (!match) return null;
  const sequence = Number.parseInt(match[2], 10);
  if (!Number.isFinite(sequence) || sequence <= 0) return null;
  const year2 = match[1];
  return { year2, sequence, docNumber: canonicalOutgoingDocNumber(year2, sequence) };
}

export function nextSerialDocNumber(
  numbers: string[],
  kind: 'outgoing' | 'received',
  year = new Date().getFullYear(),
): string {
  const year2 = String(year).slice(-2);
  const pattern = kind === 'outgoing' ? OUTGOING_DOC_PATTERN : RECEIVED_DOC_PATTERN;
  let max = 0;
  for (const value of numbers) {
    const match = String(value || '').match(pattern);
    if (!match || match[1] !== year2) continue;
    const sequence = Number.parseInt(match[2], 10);
    if (Number.isFinite(sequence) && sequence > max) max = sequence;
  }
  return kind === 'outgoing'
    ? canonicalOutgoingDocNumber(year2, max + 1)
    : canonicalReceivedDocNumber(year2, max + 1);
}

export type ParsedOfficialLetter = {
  docNumber: string | null;
  subject: string;
  recipient: string;
  reference: string;
  dispatchDate: string;
  paragraphs: string[];
};

function spacedLabel(label: string): string {
  return label.split('').join('\\s*');
}

function fieldAfter(text: string, label: string): string {
  const re = new RegExp(`(?:^|\\n)\\s*${spacedLabel(label)}\\s*[:：]\\s*(.+)`);
  const match = text.match(re);
  return match?.[1]?.trim() ?? '';
}

function formatDispatchDate(text: string): string {
  const match = text.match(/(\d{4})\s*[.년]\s*(\d{1,2})\s*[.월]\s*(\d{1,2})/);
  if (!match) return '';
  const month = match[2].padStart(2, '0');
  const day = match[3].padStart(2, '0');
  return `${match[1]}. ${month}. ${day}.`;
}

export function parseOfficialLetterText(raw: string): ParsedOfficialLetter {
  const text = String(raw || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim();
  const found = readOutgoingDocNumber(text);
  const recipient = fieldAfter(text, '수신') || fieldAfter(text, '수신처');
  const reference = fieldAfter(text, '참조');
  let subject = fieldAfter(text, '제목');
  if (!subject) {
    const line = text
      .split('\n')
      .map((row) => row.trim())
      .find((row) => /의\s*[건件]\s*$/.test(row) && !OUTGOING_DOC_PATTERN.test(row));
    subject = line?.replace(/^제\s*목\s*[:：]\s*/, '').trim() ?? '';
  }

  const paragraphs = text
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => {
      if (!row || row === subject) return false;
      if (OUTGOING_DOC_PATTERN.test(row)) return false;
      if (/^(수신|수신처|참조|제목|발신|시행)/.test(row.replace(/\s/g, ''))) return false;
      if (/^[-–—]\s*아\s*래\s*[-–—]$/.test(row)) return false;
      return row.length >= 8;
    })
    .slice(0, 8);

  return {
    docNumber: found?.docNumber ?? null,
    subject,
    recipient,
    reference,
    dispatchDate: formatDispatchDate(text),
    paragraphs,
  };
}

export function hangulCount(text: string): number {
  return (String(text || '').match(/[\uAC00-\uD7A3]/g) || []).length;
}

/** 이 정도 한글이 있으면 스캔 판독 없이 원문만 쓴다. */
export const LETTER_TEXT_ENOUGH = 40;
