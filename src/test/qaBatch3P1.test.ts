import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isSafetyCostYearAnomaly,
  safetyCostReportStatusLabel,
  safetyCostSeverityLabel,
  safetyCostViolationLabel,
} from '@/lib/safetyCostLabels';
import { withTopicParticle } from '@/lib/koreanParticle';
import { permitTbmStatusMessage, TBM_WAITS_FOR_APPROVAL } from '@/lib/tbmFromPermit';

describe('QA Batch 3 (P1) regressions — PR #688 consensus', () => {
  describe('#10 Safety cost Korean labels, company display, and OCR year anomaly', () => {
    it('localizes report statuses, severities, and violation codes into Korean', () => {
      expect(safetyCostReportStatusLabel('draft')).toBe('작성중');
      expect(safetyCostReportStatusLabel('approved')).toBe('승인완료');
      expect(safetyCostReportStatusLabel('submitted')).toBe('상신됨');
      expect(safetyCostSeverityLabel('high')).toBe('높음');
      expect(safetyCostSeverityLabel('critical')).toBe('치명');
      expect(safetyCostViolationLabel('EVIDENCE_MISSING')).toBe('증빙 파일 누락');
    });

    it('detects OCR-misparsed years differing by 2+ years from report month', () => {
      expect(isSafetyCostYearAnomaly('2022-11-03', '2026-11-01')).toBe(true);
      expect(isSafetyCostYearAnomaly('2023-11-16', '2026-11-01')).toBe(true);
      expect(isSafetyCostYearAnomaly('2026-11-10', '2026-11-01')).toBe(false);
      expect(isSafetyCostYearAnomaly('2025-12-30', '2026-01-01')).toBe(false);
      expect(isSafetyCostYearAnomaly(null, '2026-11-01')).toBe(false);
    });

    it('SafetyCostValidationPanel loads project company names and avoids raw English status/code', () => {
      const src = readFileSync('src/components/safety-cost/SafetyCostValidationPanel.tsx', 'utf8');
      expect(src).toContain('fetchProjectCompanies');
      expect(src).toContain('safetyCostReportStatusLabel(r.status)');
      expect(src).toContain('safetyCostSeverityLabel(v.severity)');
      expect(src).toContain('safetyCostViolationLabel(v.violation_code)');
    });
  });

  describe('#11 Global header overlap & card action clipping prevention', () => {
    it('defers AICreditBanner to xl breakpoint and keeps logout/project selector non-overlapping', () => {
      const banner = readFileSync('src/components/AICreditBanner.tsx', 'utf8');
      const layout = readFileSync('src/components/AppLayout.tsx', 'utf8');
      expect(banner).toContain('hidden xl:flex');
      expect(layout).toContain('hidden xl:block shrink-0');
      expect(layout).toContain('hidden lg:inline text-xs');
    });
  });

  describe('#12 Korean topic particle & closed permit TBM message', () => {
    it('selects 은/는 correctly by final Hangul consonant (받침)', () => {
      expect(withTopicParticle('이진수')).toBe('이진수는');
      expect(withTopicParticle('박서로')).toBe('박서로는');
      expect(withTopicParticle('김태준')).toBe('김태준은');
      expect(withTopicParticle('김민성')).toBe('김민성은');
      expect(withTopicParticle('')).toBe('');
    });

    it('does not tell closed or voided permits that TBM will be auto-created after approval', () => {
      expect(permitTbmStatusMessage({ status: '종료 완료', hasLinkedTbm: false })).toBe(
        '종료된 작업허가서이며 연계된 TBM이 없습니다.',
      );
      expect(permitTbmStatusMessage({ status: '종료', hasLinkedTbm: true })).toBe(
        '종료된 작업허가서의 연계 TBM 기록입니다.',
      );
      expect(permitTbmStatusMessage({ status: '작성중', hasLinkedTbm: false })).toBe(TBM_WAITS_FOR_APPROVAL);
      expect(permitTbmStatusMessage({ status: '반려', hasLinkedTbm: false })).toContain('반려된 허가서');
      expect(permitTbmStatusMessage({ status: '승인', isVoided: true })).toBe('작업 취소된 허가서입니다.');
    });
  });
});
