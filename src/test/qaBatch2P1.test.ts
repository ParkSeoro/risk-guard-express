import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatSignatureLedgerDetail, signedAtSeoulDate } from '@/lib/laborEvidence';
import { isInspectionCompletedStatus, isInspectionEditLocked } from '@/lib/legalForms/patrolLog';
import { officialChecklist } from '@/lib/legalForms/officialInspectionForms';

describe('QA Batch 2 (P1) regressions — PR #688 consensus', () => {
  describe('#6 Signature ledger localization, TBM session title, and KST date comparison', () => {
    it('localizes raw ra_share source tokens into Korean', () => {
      expect(formatSignatureLedgerDetail('ra_share', 'notice')).toBe('위험성평가 공지 확인');
      expect(formatSignatureLedgerDetail('ra_share', 'qr')).toBe('QR 확인');
      expect(formatSignatureLedgerDetail('ra_share', 'daily_ack')).toBe('출근 서약 연동');
      expect(formatSignatureLedgerDetail('tbm', '[허가서] OSBL 배관공사')).toBe('[허가서] OSBL 배관공사');
      expect(formatSignatureLedgerDetail('tbm', '')).toBeNull();
    });

    it('computes KST YYYY-MM-DD from UTC timestamps cleanly', () => {
      expect(signedAtSeoulDate('2026-11-20T22:28:40Z')).toBe('2026-11-21');
      expect(signedAtSeoulDate('2026-11-19T08:38:37Z')).toBe('2026-11-19');
      expect(signedAtSeoulDate(null)).toBeNull();
    });

    it('migration updates list_worker_signature_ledger to return TBM session title', () => {
      const sql = readFileSync('supabase/migrations/20261121154000_signature_ledger_tbm_title.sql', 'utf8');
      expect(sql).toContain("COALESCE(NULLIF(trim(s.title), ''), 'TBM 참여')");
    });
  });

  describe('#7 Safety inspection uniform lock (master exception only) & FAC-06 typo fix', () => {
    it('locks completed/결재진행 for non-masters and exempts master only', () => {
      expect(isInspectionEditLocked('completed', false)).toBe(true);
      expect(isInspectionEditLocked('완료', false)).toBe(true);
      expect(isInspectionEditLocked('결재진행', false)).toBe(true);
      expect(isInspectionEditLocked('in_progress', false)).toBe(false);
      expect(isInspectionEditLocked('completed', true)).toBe(false);
      expect(isInspectionEditLocked('결재진행', true)).toBe(false);
    });

    it('fixes FAC-06 typo from 결하 to 결속 for new inspections', () => {
      const items = officialChecklist('facility_sf009');
      const fac06 = items.find((i) => i.code === 'FAC-06');
      expect(fac06?.label).toContain('결속 및 설치 상태');
      expect(fac06?.label).not.toContain('결하');
    });

    it('unifies SafetyInspections badges (completed/완료/승인완료 -> 완료) and master-exempt edit lock across all sections', () => {
      expect(isInspectionCompletedStatus('completed')).toBe(true);
      expect(isInspectionCompletedStatus('완료')).toBe(true);
      expect(isInspectionCompletedStatus('승인완료')).toBe(true);
      expect(isInspectionCompletedStatus('결재진행')).toBe(false);
      expect(isInspectionCompletedStatus('in_progress')).toBe(false);

      const src = readFileSync('src/pages/SafetyInspections.tsx', 'utf8');
      expect(src).not.toContain('<Badge className="bg-success">종료</Badge>');
      expect(src).toContain('isInspectionCompletedStatus(i.status)');
      expect(src).toContain('readOnly={isInspectionEditLocked(detail.status, isMaster)}');
      expect(src).not.toContain('readOnly={isPatrolLogLocked(detail.status)}');
    });
  });

  describe('#8 Risk assessment rejected label & locked Excel import guard', () => {
    it('AssessmentRuns maps 반려 to 반려 · 재상신 필요 instead of 미상신', () => {
      const src = readFileSync('src/pages/AssessmentRuns.tsx', 'utf8');
      expect(src).toContain("if (run.status === '반려') return { label: '반려 · 재상신 필요'");
    });

    it('AssessmentRunDetail hides 엑셀 가져오기 when not editable', () => {
      const src = readFileSync('src/pages/AssessmentRunDetail.tsx', 'utf8');
      expect(src).toMatch(/\{canEdit && \(\s*<DropdownMenuItem[^>]*>[\s\S]*?엑셀 가져오기/);
    });
  });

  describe('#9 Work plans 작업취소 status chip & single TBM notice button', () => {
    it('WorkPlans includes 작업취소 in summary chips', () => {
      const src = readFileSync('src/pages/WorkPlans.tsx', 'utf8');
      expect(src).toContain("['작성중', '결재중', '승인완료', '반려', '만료', '작업취소']");
    });

    it('WorkPlanDetail removes duplicate TBM 자동생성(주지) button while keeping 근로자 주지 card', () => {
      const src = readFileSync('src/pages/WorkPlanDetail.tsx', 'utf8');
      expect(src).not.toContain('TBM 자동생성(주지)');
      expect(src).toContain('TBM 만들어 주지하기');
    });
  });
});
