import { describe, expect, it } from 'vitest';
import {
  OCR_STATUS_LABEL,
  estimateOcrConfidence,
  ocrReviewGaps,
  ocrStatusLabel,
  resolveOcrStatus,
  stampOcrOnItem,
  summarizeOcrItems,
} from '@/lib/safetyCostOcr';
import { normalizeLegacyDraft, parseLegacyTextDraft } from '@/lib/safetyCostLegacyImport';

describe('safetyCostOcr', () => {
  it('keeps Korean status phrases as SSOT', () => {
    expect(OCR_STATUS_LABEL.ocr_raw).toBe('OCR 원문입니다. 숫자·상호를 원본과 대조하세요.');
    expect(OCR_STATUS_LABEL.ocr_low).toBe('OCR 신뢰도가 낮습니다. 원본 증빙을 확인하세요.');
    expect(OCR_STATUS_LABEL.ai_corrected).toBe('AI가 OCR 결과를 보정했습니다. 원본과 다른 칸을 확인하세요.');
    expect(OCR_STATUS_LABEL.rule_fallback).toBe('규칙 기반 예비 추출입니다. 거래날짜·공급자·세액을 확인하세요.');
    expect(OCR_STATUS_LABEL.user_edited).toBe('사용자가 OCR 결과를 직접 수정했습니다.');
    expect(OCR_STATUS_LABEL.no_vision).toBe('이미지 판독을 건너뛰었습니다. 엑셀이 아니면 항목이 비었을 수 있습니다.');
  });

  it('maps skipped vision to no_vision phrase', () => {
    const stamped = stampOcrOnItem({ item_name: '안전모' }, { noVision: true, rawText: '' });
    expect(stamped.ocr_status).toBe('no_vision');
    expect(ocrStatusLabel(stamped.ocr_status)).toBe(OCR_STATUS_LABEL.no_vision);
  });

  it('maps low confidence to ocr_low phrase', () => {
    expect(resolveOcrStatus({ confidence: 0.4 })).toBe('ocr_low');
    expect(ocrStatusLabel('ocr_low')).toBe(OCR_STATUS_LABEL.ocr_low);
    expect(estimateOcrConfidence('abc', 0.9)).toBeLessThan(0.7);
  });

  it('maps AI field correction to ai_corrected', () => {
    const stamped = stampOcrOnItem(
      { item_name: '안전모', fields_corrected: true },
      { confidence: 0.9, rawText: '안전모 10개' },
    );
    expect(stamped.ocr_status).toBe('ai_corrected');
    expect(ocrStatusLabel(stamped.ocr_status)).toBe(OCR_STATUS_LABEL.ai_corrected);
  });

  it('lets user_edited win over low confidence and no_vision', () => {
    expect(resolveOcrStatus({
      userEdited: true,
      noVision: true,
      confidence: 0.1,
      fieldsCorrected: true,
    })).toBe('user_edited');
    const stamped = stampOcrOnItem(
      { ocr_status: 'ocr_low' },
      { userEdited: true, confidence: 0.2 },
    );
    expect(stamped.ocr_status).toBe('user_edited');
    expect(ocrStatusLabel(stamped.ocr_status)).toBe(OCR_STATUS_LABEL.user_edited);
  });

  it('summarizes OCR rows for the review banner', () => {
    const s = summarizeOcrItems([
      { ocr_status: 'ocr_low', ocr_raw_text: '가나다라' },
      { ocr_status: 'ai_corrected', ocr_raw_text: '마바' },
      { ocr_status: 'no_vision', ocr_raw_text: '' },
    ]);
    expect(s.count).toBe(3);
    expect(s.lowCount).toBe(2);
    expect(s.correctedCount).toBe(1);
    expect(s.rawChars).toBe(6);
  });

  it('blocks submit when low-confidence review rows lack a reason', () => {
    const gaps = ocrReviewGaps([
      { ocr_status: 'ocr_low', classification_status: 'review', ai_reason: '', is_deleted: false },
      { ocr_status: 'ocr_low', classification_status: 'review', ai_reason: '원본 확인함', is_deleted: false },
      { ocr_status: 'ocr_raw', classification_status: 'review', ai_reason: '', is_deleted: false },
    ]);
    expect(gaps).toHaveLength(1);
  });
});

describe('legacy import OCR provenance', () => {
  it('stamps rule_fallback on text parse', () => {
    const draft = parseLegacyTextDraft(`
2026년 07월 사용내역 집계
안전모 흰 10개 150,000
`);
    expect(draft.items || draft.months[0].items).toBeTruthy();
    expect(draft.months[0].items[0].ocr_status).toBe('rule_fallback');
    expect(ocrStatusLabel(draft.months[0].items[0].ocr_status)).toBe(OCR_STATUS_LABEL.rule_fallback);
  });

  it('marks month total mismatch as ocr_low unless user_edited', () => {
    const draft = normalizeLegacyDraft({
      months: [{
        report_month: '2026-07',
        declared_total: 100000,
        items: [
          { item_name: '안전모', amount: 40000, category_code: '3', ocr_status: 'ocr_raw', ocr_confidence: 0.9 },
          { item_name: '교육비', amount: 50000, category_code: '5', ocr_status: 'user_edited' },
        ],
      }],
    });
    expect(draft.months[0].items[0].ocr_status).toBe('ocr_low');
    expect(draft.months[0].items[1].ocr_status).toBe('user_edited');
  });
});
