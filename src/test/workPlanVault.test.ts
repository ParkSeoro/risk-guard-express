import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  classifyVaultSuggestions,
  isReusableAttachmentKey,
  type CompanyVaultDoc,
  type VaultChecklistRowLike,
} from '@/lib/workPlanVault';

const REF_DATE = '2026-11-24';

function makeDoc(overrides: Partial<CompanyVaultDoc> = {}): CompanyVaultDoc {
  return {
    id: 'doc-1',
    project_id: 'proj-1',
    company_id: 'comp-a',
    attachment_key: 'biz_license',
    doc_name: '사업자등록증',
    file_url: 'https://example.com/biz.pdf',
    file_path: 'proj-1/biz.pdf',
    file_size: 1024,
    mime_type: 'application/pdf',
    holder_name: '청원산기(주)',
    reg_or_cert_no: '123-45-67890',
    expiry_date: '2027-06-30',
    updated_at: '2026-11-20T00:00:00Z',
    ...overrides,
  };
}

function makeRow(overrides: Partial<VaultChecklistRowLike> = {}): VaultChecklistRowLike {
  return {
    id: 'row-1',
    attachment_key: 'biz_license',
    name: '사업자등록증',
    file_url: null,
    locked: false,
    ...overrides,
  };
}

describe('Phase 2: Confirmation-Based Hybrid Document Vault', () => {
  it('excludes custom ad-hoc keys from reusable vault keys', () => {
    expect(isReusableAttachmentKey('biz_license')).toBe(true);
    expect(isReusableAttachmentKey('insurance_cert')).toBe(true);
    expect(isReusableAttachmentKey('custom_1764000000000')).toBe(false);
    expect(isReusableAttachmentKey('')).toBe(false);
    expect(isReusableAttachmentKey(null)).toBe(false);
  });

  it('enforces strict company_id tenant isolation', () => {
    const docs = [
      makeDoc({ id: 'd-other', company_id: 'comp-b', attachment_key: 'biz_license' }),
      makeDoc({ id: 'd-own', company_id: 'comp-a', attachment_key: 'insurance_cert', doc_name: '보험가입증명서' }),
    ];
    const rows = [
      makeRow({ id: 'r1', attachment_key: 'biz_license', name: '사업자등록증' }),
      makeRow({ id: 'r2', attachment_key: 'insurance_cert', name: '보험가입증명서' }),
    ];

    const res = classifyVaultSuggestions(docs, rows, 'comp-a', REF_DATE);
    expect(res.suggestable.map((s) => s.doc.id)).toEqual(['d-own']);
    expect(res.expired).toHaveLength(0);

    // Missing companyId must yield zero suggestions
    const empty = classifyVaultSuggestions(docs, rows, null, REF_DATE);
    expect(empty.suggestable).toHaveLength(0);
    expect(empty.expired).toHaveLength(0);
  });

  it('never suggests expired documents and routes them to expired warnings', () => {
    const docs = [
      makeDoc({ id: 'd-valid', attachment_key: 'biz_license', expiry_date: '2027-05-01' }),
      makeDoc({ id: 'd-soon', attachment_key: 'insurance_cert', expiry_date: '2026-12-10' }),
      makeDoc({ id: 'd-expired', attachment_key: 'inspection_cert', expiry_date: '2026-11-23' }),
      makeDoc({ id: 'd-no-exp', attachment_key: 'spec_sheet', expiry_date: null }),
    ];
    const rows = [
      makeRow({ id: 'r1', attachment_key: 'biz_license' }),
      makeRow({ id: 'r2', attachment_key: 'insurance_cert' }),
      makeRow({ id: 'r3', attachment_key: 'inspection_cert' }),
      makeRow({ id: 'r4', attachment_key: 'spec_sheet' }),
    ];

    const res = classifyVaultSuggestions(docs, rows, 'comp-a', REF_DATE);
    expect(res.suggestable.map((s) => s.doc.id)).toEqual(['d-valid', 'd-soon', 'd-no-exp']);
    expect(res.suggestable.find((s) => s.doc.id === 'd-soon')?.expiry).toBe('expiring_soon');
    expect(res.suggestable.find((s) => s.doc.id === 'd-soon')?.daysRemaining).toBe(16);
    expect(res.expired.map((s) => s.doc.id)).toEqual(['d-expired']);
  });

  it('skips locked rows, already-uploaded rows, and custom_* rows', () => {
    const docs = [
      makeDoc({ id: 'd1', attachment_key: 'biz_license' }),
      makeDoc({ id: 'd2', attachment_key: 'insurance_cert' }),
      makeDoc({ id: 'd3', attachment_key: 'custom_123' }),
    ];
    const rows = [
      makeRow({ id: 'r1', attachment_key: 'biz_license', locked: true }),
      makeRow({ id: 'r2', attachment_key: 'insurance_cert', file_url: 'https://already.uploaded/x.pdf' }),
      makeRow({ id: 'r3', attachment_key: 'custom_123' }),
    ];

    const res = classifyVaultSuggestions(docs, rows, 'comp-a', REF_DATE);
    expect(res.suggestable).toHaveLength(0);
    expect(res.expired).toHaveLength(0);
  });

  it('picks the most recently updated vault doc when duplicates exist', () => {
    const docs = [
      makeDoc({ id: 'd-old', attachment_key: 'biz_license', updated_at: '2026-10-01T00:00:00Z' }),
      makeDoc({ id: 'd-new', attachment_key: 'biz_license', updated_at: '2026-11-22T00:00:00Z' }),
    ];
    const rows = [makeRow({ id: 'r1', attachment_key: 'biz_license' })];

    const res = classifyVaultSuggestions(docs, rows, 'comp-a', REF_DATE);
    expect(res.suggestable.map((s) => s.doc.id)).toEqual(['d-new']);
  });

  it('keeps vault save strictly opt-in and enforces company-scoped RLS in SQL migration', () => {
    const uiSrc = readFileSync(
      resolve(__dirname, '../components/work-plan/AttachmentChecklist.tsx'),
      'utf-8',
    );
    expect(uiSrc).toContain('useState(false);');
    expect(uiSrc).toContain('setSaveToVaultOptIn');
    expect(uiSrc).toContain('handleApplyVault');

    const sqlSrc = readFileSync(
      resolve(__dirname, '../../supabase/migrations/20261124080000_work_plan_document_vault.sql'),
      'utf-8',
    );
    expect(sqlSrc).toContain('company_id uuid NOT NULL');
    expect(sqlSrc).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sqlSrc).toContain('can_read_company_data(auth.uid(), project_id, company_id)');
    expect(sqlSrc).toContain('can_write_company_data(auth.uid(), project_id, company_id)');
  });
});
