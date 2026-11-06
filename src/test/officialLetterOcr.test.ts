import { describe, expect, it } from 'vitest';
import {
  canonicalOutgoingDocNumber,
  nextSerialDocNumber,
  parseOfficialLetterText,
  readOutgoingDocNumber,
} from '@/lib/officialLetterOcr';

describe('official letter numbers', () => {
  it('keeps an outside letter number in the same sequence', () => {
    const parsed = readOutgoingDocNumber('ALK Technology-Construction Safety-26-7호');
    expect(parsed?.docNumber).toBe(canonicalOutgoingDocNumber('26', 7));
    const next = nextSerialDocNumber(
      [
        'ALK Technology - Construction Safety - 26-01호',
        'ALK Technology - Construction Safety - 26-02호',
        parsed!.docNumber,
      ],
      'outgoing',
      2026,
    );
    expect(next).toBe('ALK Technology - Construction Safety - 26-08호');
  });

  it('reads recipient, title, and date without inventing a missing number', () => {
    const parsed = parseOfficialLetterText(`
ALK Technology - Construction Safety - 26-04호
수 신 : 각 사 대표이사
참 조 : 기술본부 CM팀
제 목 : 하절기 온열질환 예방 협조의 건
2026. 8. 10.
귀 사의 무궁한 발전과 건설 현장의 무재해를 기원합니다.
    `);
    expect(parsed.docNumber).toBe('ALK Technology - Construction Safety - 26-04호');
    expect(parsed.recipient).toBe('각 사 대표이사');
    expect(parsed.reference).toBe('기술본부 CM팀');
    expect(parsed.subject).toContain('온열질환');
    expect(parsed.dispatchDate).toBe('2026. 08. 10.');
    expect(parsed.paragraphs.some((row) => row.includes('무재해'))).toBe(true);
  });

  it('leaves the number empty when the page has no official number', () => {
    const parsed = parseOfficialLetterText('수신 : 협력사\n제목 : 안전점검 요청의 건');
    expect(parsed.docNumber).toBeNull();
    expect(parsed.subject).toContain('안전점검');
  });
});
