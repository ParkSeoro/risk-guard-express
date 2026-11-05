import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveNotificationRoute } from '@/lib/notificationRoutes';
import {
  buildSafetyCostDocument,
  categoryLabelWithBind,
  defaultSafetyCostPrintScope,
  ledgerPrintStatus,
  lowerPhotoCaption,
  upperPhotoCaption,
  usageBasisAmount,
  type SafetyCostDocFile,
  type SafetyCostDocInput,
} from '@/lib/safetyCostDocumentBuilder';

function doc(over: Partial<SafetyCostDocInput> = {}): SafetyCostDocInput {
  return {
    report: {
      year_month: '2026-08',
      status: 'draft',
      source: 'manual',
      cumulative_progress_rate: null,
      safety_cost_total: 10000000,
      contract_amount: 100000000,
      construction_name: '여수 현장',
    },
    companyName: '세이프넥스',
    companyAddress: '서울',
    clientName: '발주처',
    items: [],
    files: [],
    ledger: [],
    ...over,
  };
}

const facilityFiles: SafetyCostDocFile[] = [
  {
    id: 'tx',
    item_id: 'i2',
    evidence_kind: 'transaction',
    file_name: '명세.jpg',
    mime_type: 'image/jpeg',
    file_url: 'https://example.test/spec.jpg',
  },
  {
    id: 'ph',
    item_id: 'i2',
    evidence_kind: 'site_photo',
    note: '설치 위치',
    file_name: '현장.jpg',
    mime_type: 'image/jpeg',
  },
  {
    id: 'tax',
    evidence_kind: 'tax_invoice',
    category_code: '2',
    note: '',
    file_name: '세금계산서.pdf',
    file_path: 'safety-cost/tax.pdf',
    mime_type: 'application/pdf',
  },
  {
    id: 'cert',
    item_id: 'i2',
    evidence_kind: 'certificate',
    file_name: '인증서.pdf',
    mime_type: 'application/pdf',
  },
];

describe('safety cost document builder', () => {
  it('default bundle keeps summary, items, photo and tax, ledger, and drops certificates', () => {
    const html = buildSafetyCostDocument(doc({
      items: [{ id: 'i2', category_code: '2', item_name: '난간', amount: 1000, supplier_name: '가나다' }],
      files: facilityFiles,
    }), defaultSafetyCostPrintScope(false)).html;
    expect(html).toContain('1. 사용내역 총괄');
    expect(html).toContain('2. 항목별 사용내역');
    expect(html).toContain('4. 안전시설비 등');
    expect(html).toContain('거래명세표');
    expect(html).not.toContain('거래명세표/검수');
    expect(html).toContain('안전시설물 설치');
    expect(html).toContain('배분 메모 없음');
    expect(html).toContain('세금계산서.pdf');
    expect(html).not.toContain('11,224,800');
    expect(html).not.toContain('11224800');
    expect(html).toContain('7. 개인보호구 지급대장');
    expect(html).toContain('해당 없음');
    expect(html).not.toContain('8. 원본');
    expect(html).not.toContain('월별 집계표');
    expect(html).not.toContain('업체별 집계표');
  });

  it('does not invent a usage basis when progress is blank', () => {
    expect(usageBasisAmount(null, 10000000)).toBeNull();
    const html = buildSafetyCostDocument(doc(), defaultSafetyCostPrintScope(false)).html;
    expect(html).toContain('<th>사용기준금액</th><td></td>');
  });

  it('places category 2 on bind 4 and category 4 on bind 9', () => {
    expect(categoryLabelWithBind('2')).toMatch(/^4\./);
    expect(categoryLabelWithBind('4')).toMatch(/^9\./);
    const files: SafetyCostDocFile[] = [{
      id: 'd',
      item_id: 'i4',
      evidence_kind: 'site_photo',
      note: '진단 현장',
      file_name: '진단.jpg',
      mime_type: 'image/jpeg',
    }];
    expect(lowerPhotoCaption('4', files)).toBe('안전보건진단');
    expect(lowerPhotoCaption('3', files)).toBe('보호구 사진');
    expect(lowerPhotoCaption('3', [{ ...files[0], note: '검수 완료' }])).toBe('보호구 검수');
    expect(upperPhotoCaption(facilityFiles)).toBe('거래명세표');
    const html = buildSafetyCostDocument(doc({
      items: [{ id: 'i4', category_code: '4', item_name: '진단', amount: 500 }],
      files,
    }), defaultSafetyCostPrintScope(false)).html;
    expect(html).toContain('9. 안전보건진단비 등');
    expect(html).not.toContain('보호구 검수');
  });

  it('prints a legacy month as summary and items only', () => {
    const html = buildSafetyCostDocument(doc({
      report: { ...doc().report, source: 'legacy_import' },
      items: [{ id: 'i2', category_code: '2', item_name: '난간', amount: 1000 }],
      files: facilityFiles,
    }), defaultSafetyCostPrintScope(true)).html;
    expect(html).toContain('이관 월');
    expect(html).toContain('1. 사용내역 총괄');
    expect(html).toContain('2. 항목별 사용내역');
    expect(html).not.toContain('당월 사용내역 없음');
    expect(html).not.toContain('안전시설물 설치');
    expect(html).not.toContain('세금계산서.pdf');
  });

  it('separates an empty ledger from an unsigned ledger', () => {
    expect(ledgerPrintStatus(0, 0)).toBe('해당 없음');
    expect(ledgerPrintStatus(1000, 0)).toBe('미작성');
    const html = buildSafetyCostDocument(doc({
      items: [{ id: 'i3', category_code: '3', item_name: '안전모', amount: 1000 }],
      ledger: [{ worker_name: '홍길동', signature_data: '' }],
    }), defaultSafetyCostPrintScope(false)).html;
    expect(html).toContain('미작성');
    expect(html).not.toContain('해당 없거나 미작성');
  });

  it('opens the same report from the inbox path and the admin notification', () => {
    const preview = readFileSync('src/lib/approvalInboxPreview.ts', 'utf8');
    expect(preview).toContain('/app/admin/safety-cost?reportId=');
    expect(preview).toContain('entityType === "safety_cost"');
    const dialog = readFileSync('src/components/approval/ApprovalDocPreviewDialog.tsx', 'utf8');
    expect(dialog).not.toContain('pdfPageRasterizer');
    expect(dialog).not.toContain('pdfjs');
    expect(resolveNotificationRoute({
      related_type: 'safety_cost',
      related_id: 'rep-1',
    }, { mobileShell: false })).toBe('/app/admin/safety-cost?reportId=rep-1');
    expect(resolveNotificationRoute({
      related_type: 'work_permit',
      related_id: 'p1',
    }, { mobileShell: false })).toBe('/app/admin/work-permits/p1');
  });
});
