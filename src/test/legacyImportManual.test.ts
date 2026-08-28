import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('승인본 이관은 총괄 비목 금액 수기', () => {
  it('does not call OCR/AI extract on the archive panel', () => {
    const src = readFileSync('src/components/safety-cost/LegacyImportWizard.tsx', 'utf8');
    expect(src).not.toMatch(/analyze-safety-cost-document/);
    expect(src).not.toMatch(/mode:\s*['"]legacy_pack['"]/);
    expect(src).toMatch(/evidence_kind: 'legacy_pack'/);
    expect(src).toMatch(/commit_safety_cost_legacy_import/);
    expect(src).toMatch(/이관 총괄 입력/);
    expect(src).toMatch(/첫 월 추가/);
    expect(src).not.toMatch(/추출 → 검수 → 확정/);
  });
});
