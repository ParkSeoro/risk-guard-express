import { describe, expect, it } from 'vitest';
import { officialLetterObjectName } from '@/lib/ownerOfficialLetters';

describe('official letter file names', () => {
  it('keeps hangul out of the stored object name', () => {
    const name = officialLetterObjectName('공문 ALK Technology - Construction Safety - 26-03호.PDF', 'abc');
    expect(name).toBe('abc.pdf');
    expect(name).not.toMatch(/[가-힣]/);
  });
});
