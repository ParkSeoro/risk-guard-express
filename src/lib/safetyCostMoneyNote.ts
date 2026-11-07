/** 증빙 메모에 금액을 같이 적는다. 표에 금액 칸을 더하지 않는다. */

const TAG = /\[\[sc\b([\s\S]*?)\]\]/;
const TOTAL = /(?:^|\s)total=(\d+(?:\.\d+)?)/;
const PART = /(?:^|\s)part=(\d+(?:\.\d+)?)/;

export type SafetyCostMoneyNote = {
  total: number | null;
  part: number | null;
  text: string;
};

export function parseSafetyCostMoneyNote(note: string | null | undefined): SafetyCostMoneyNote {
  const raw = String(note || '');
  const hit = raw.match(TAG);
  const body = hit?.[1] || '';
  const total = body.match(TOTAL);
  const part = body.match(PART);
  return {
    total: total ? Number(total[1]) : null,
    part: part ? Number(part[1]) : null,
    text: raw.replace(TAG, '').trim(),
  };
}

export function encodeSafetyCostMoneyNote(input: {
  total?: number | null;
  part?: number | null;
  text?: string | null;
}): string {
  const bits = ['[[sc'];
  if (input.total != null && Number.isFinite(Number(input.total))) bits.push(`total=${Math.round(Number(input.total))}`);
  if (input.part != null && Number.isFinite(Number(input.part))) bits.push(`part=${Math.round(Number(input.part))}`);
  const text = String(input.text || '').trim();
  const tag = `${bits.join(' ')}]]`;
  return text ? `${tag}${text}` : tag;
}

export function sameWon(a: number, b: number): boolean {
  return Math.abs(Math.round(a) - Math.round(b)) <= 1;
}
