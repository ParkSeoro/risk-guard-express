import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(process.cwd(), 'supabase/functions/generate-pdf/index.ts'), 'utf8');

describe('generate-pdf RA table layout', () => {
  it('does not nowrap 공정 into the 세부작업 column', () => {
    expect(src).not.toMatch(/<td class="nowrap">\$\{item\.process/);
    expect(src).toMatch(/class="risk-grid"/);
    expect(src).toMatch(/max-width: 0/);
    expect(src).toMatch(/width:10%">공정/);
    expect(src).toMatch(/width:10%">세부작업/);
  });

  it('counts only live (not deleted/excluded) items in the header', () => {
    expect(src).toMatch(/\.eq\("is_deleted", false\)/);
    expect(src).toMatch(/!i\?\.is_excluded/);
  });

  it('uses saved previous_run_id for 금주 이행 확인 when auto-link misses', () => {
    expect(src).toMatch(/run\.previous_run_id/);
    expect(src).toMatch(/overrideId/);
  });
});
