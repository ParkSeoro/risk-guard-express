import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('승인본 이관은 수기·보관만', () => {
  it('does not call OCR/AI extract on the archive panel', () => {
    const src = readFileSync('src/components/safety-cost/LegacyImportWizard.tsx', 'utf8');
    expect(src).not.toMatch(/analyze-safety-cost-document/);
    expect(src).not.toMatch(/mode:\s*['"]legacy_pack['"]/);
    expect(src).toMatch(/evidence_kind: 'legacy_pack'/);
    expect(src).toMatch(/월별 작성/);
    expect(src).not.toMatch(/추출 → 검수 → 확정/);
  });
});
