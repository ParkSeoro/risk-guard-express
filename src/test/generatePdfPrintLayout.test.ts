import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(process.cwd(), 'supabase/functions/generate-pdf/index.ts'), 'utf8');
const chainSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261002120000_assessment_company_chain.sql'),
  'utf8',
);

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

  it('loads 금주 and 전회차 from the shared company chain', () => {
    expect(src).toMatch(/assessment_feedback_chain/);
    expect(src).toMatch(/previousRunId/);
    expect(src).toMatch(/_override_previous_id/);
    expect(src).not.toMatch(/\.limit\(80\)/);
    expect(src).not.toMatch(/na\.length === 0 && nb\.length === 0\) return true/);
    expect(src).not.toMatch(/stampEffectiveCompanies/);
    expect(chainSql).toMatch(/project_member_role_rank/);
    expect(chainSql).toMatch(/ORDER BY public\.project_member_role_rank/);
    expect(chainSql).toMatch(/assessment_feedback_chain/);
    expect(chainSql).toMatch(/skip_document_edit_lock/);
    expect(chainSql).toMatch(/COALESCE\(array_length\(_a, 1\), 0\) > 0/);
  });

  it('lists each printed 공정 once above the signature block', () => {
    const headerAt = src.indexOf('대상 공정');
    const signAt = src.indexOf('>서명란<');
    expect(headerAt).toBeGreaterThan(-1);
    expect(signAt).toBeGreaterThan(headerAt);
    expect(src).toMatch(/function uniquePrintedProcessNames/);
    expect(src).toMatch(/uniquePrintedProcessNames\(items\)/);
    expect(src).not.toMatch(/target_processes/);
    expect(src).toMatch(/width:10%">공정/);
    expect(src).toMatch(/<td>\$\{item\.process \|\| ""\}<\/td>/);
  });

  it('prints 결재 코멘트 under the signature table', () => {
    expect(src).toMatch(/approvalCommentsPrintHtml/);
    expect(src).toMatch(/commentHtml/);
  });

  it('prints 전회차 and 금주 이행 확인, and does not embed PDFs as images', () => {
    expect(src).toMatch(/전회차 이행 확인/);
    expect(src).toMatch(/금주 이행 확인/);
    expect(src).toMatch(/assessment_feedback/);
    expect(src).toMatch(/isPdfAttachmentUrl/);
    expect(src).toMatch(/PDF 첨부/);
    expect(src).toMatch(/등록된 이행 확인이 없습니다/);
    expect(src).toMatch(/showEmptyFeedbackSection/);
    expect(src).toMatch(/assessment_run_share_acks/);
    expect(src).toMatch(/buildShareSignatureRows/);
    expect(src).toMatch(/safeSignatureSrc/);
    expect(src).toMatch(/periodRange/);
    expect(src).toMatch(/pdfFileName/);
  });
});
